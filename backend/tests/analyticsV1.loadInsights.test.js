// NOTE: Phase-3 — Frontend uses /api/analytics/v1, staged loader on dashboards, Ajv strict. Rollback via flags.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const originalLoad = Module._load;
Module._load = function patchedLoader(request, parent, isMain) {
  if (request === 'express') {
    const expressMock = () => ({ use() {}, get() {}, post() {} });
    expressMock.Router = () => ({ use() {}, get() {}, post() {} });
    return expressMock;
  }
  if (request === 'mongoose') {
    class ObjectId {
      constructor(value) {
        this.value = value;
      }
      toString() {
        return String(this.value);
      }
    }
    ObjectId.isValid = () => true;

    class Schema {
      constructor() {}
      index() {}
    }
    Schema.Types = { ObjectId };

    return {
      Schema,
      model: () => ({ find: () => ({ lean: () => ({ exec: async () => [] }) }) }),
      Types: { ObjectId },
      connection: { readyState: 0, once() {} },
    };
  }
  if (request === 'jsonwebtoken') {
    return { verify: () => ({ id: 'stub-user' }), sign: () => 'token' };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const router = require('../src/routes/analytics.v1.routes.js');
Module._load = originalLoad;

test('buildInsightMatch includes overlapping period conditions', () => {
  const { buildInsightMatch } = router.__test;
  const range = { start: '2025-09-01', end: '2025-09-30' };
  const match = buildInsightMatch('user-123', range);

  assert.equal(match.userId, 'user-123');
  assert.ok(Array.isArray(match.$or));

  const metadataPeriod = match.$or.find((entry) => Object.prototype.hasOwnProperty.call(entry, 'metadata.period.start'));
  assert.deepEqual(metadataPeriod, {
    'metadata.period.start': { $lte: '2025-09-30' },
    'metadata.period.end': { $gte: '2025-09-01' },
  });

  const metricsV1Period = match.$or.find((entry) => Object.prototype.hasOwnProperty.call(entry, 'metricsV1.period.start'));
  assert.deepEqual(metricsV1Period, {
    'metricsV1.period.start': { $lte: '2025-09-30' },
    'metricsV1.period.end': { $gte: '2025-09-01' },
  });

  const documentDate = match.$or.find((entry) => Object.prototype.hasOwnProperty.call(entry, 'documentDate'));
  assert.ok(documentDate.documentDate.$gte instanceof Date);
  assert.ok(documentDate.documentDate.$lte instanceof Date);
});
