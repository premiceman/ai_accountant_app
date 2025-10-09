// NOTE: QA Harness for Phase-3 — validates /api/analytics/v1, flags, caching, staged loader "failed". Non-breaking.
'use strict';

const express = require('express');
const { validateDashboardSummaryV1 } = require('../../../shared/v1/index.js');
const { featureFlags } = require('../lib/featureFlags');

if (process.env.NODE_ENV === 'production' || !featureFlags.enableQaDevEndpoints) {
  module.exports = null;
  return;
}

const router = express.Router();

const invalidSummary = Object.freeze({
  period: { start: '2024-01-01', end: '2024-12-31', granularity: 'year' },
  totals: { incomeMinor: -100, spendMinor: 20000, netMinor: -20100 },
  version: 'v1',
});

router.get('/emitInvalidV1', (_req, res) => {
  res.json(invalidSummary);
});

router.post('/validate/summary', (req, res) => {
  const payload = req.body ?? {};
  const valid = validateDashboardSummaryV1(payload);
  if (valid) {
    return res.json({ ok: true });
  }
  return res.status(422).json({
    code: 'SCHEMA_VALIDATION_FAILED',
    path: 'DashboardSummaryV1',
    details: validateDashboardSummaryV1.errors ?? [],
    hint: 'Strict Ajv validation (dev QA endpoint)',
  });
});

module.exports = router;
