import assert from 'node:assert/strict';
import { Types } from 'mongoose';

import { __internal__ } from '../documentJobLoop.js';
import type { DocumentInsight } from '../models/index.js';

function buildInsight(overrides: Partial<DocumentInsight>): DocumentInsight {
  return {
    _id: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    fileId: 'file',
    catalogueKey: 'payslip',
    baseKey: 'payslip',
    schemaVersion: '1',
    parserVersion: '1',
    promptVersion: '1',
    model: 'gpt',
    extractionSource: 'heuristic',
    confidence: 1,
    contentHash: 'hash',
    documentDate: new Date('2024-04-30T00:00:00.000Z'),
    documentMonth: '2024-04',
    documentLabel: null,
    documentName: null,
    nameMatchesUser: null,
    collectionId: null,
    version: null,
    currency: 'GBP',
    documentDateV1: '2024-04-30',
    metadata: { payDate: '2024-04-30' },
    metrics: { gross: 2500, net: 2000 },
    metricsV1: { grossMinor: 250000, netMinor: 200000, currency: 'GBP' },
    transactions: [],
    transactionsV1: [],
    narrative: [],
    extractedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    status: 'success',
    statusReason: null,
    ...overrides,
  } as DocumentInsight;
}

const { hasRequiredInsightFields } = __internal__;

(function run() {
  const healthy = buildInsight({});
  assert.equal(
    healthy.status === 'success' && hasRequiredInsightFields(healthy),
    true,
    'expected healthy insight to be skippable'
  );

  const missingMonth = buildInsight({
    documentMonth: null as unknown as DocumentInsight['documentMonth'],
  });
  assert.equal(
    missingMonth.status === 'success' && hasRequiredInsightFields(missingMonth),
    false,
    'missing documentMonth should prevent skip'
  );

  const failedStatus = buildInsight({ status: 'failed' });
  assert.equal(
    failedStatus.status === 'success' && hasRequiredInsightFields(failedStatus),
    false,
    'failed status should not be skipped'
  );

  const missingMetrics = buildInsight({
    metrics: { gross: null, net: null } as any,
    metricsV1: null as unknown as DocumentInsight['metricsV1'],
  });
  assert.equal(
    missingMetrics.status === 'success' && hasRequiredInsightFields(missingMetrics),
    false,
    'missing metrics should prevent skip'
  );

  console.log('Idempotency skip logic tests passed');
})();
