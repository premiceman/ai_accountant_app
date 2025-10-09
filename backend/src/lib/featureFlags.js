// NOTE: Phase-2 — backfill v1 & add /api/analytics/v1/* endpoints. Legacy endpoints unchanged.
'use strict';

const DEFAULTS = {
  ENABLE_ANALYTICS_V1: 'true',
  ENABLE_RECONCILIATION: 'false',
  ANALYTICS_V1_CACHE_TTL_SECONDS: '600',
};

function readFlag(name) {
  const raw = process.env[name];
  if (raw == null || raw === '') return DEFAULTS[name];
  return raw;
}

function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (value == null) return false;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return false;
}

const featureFlags = Object.freeze({
  enableAnalyticsV1: toBoolean(readFlag('ENABLE_ANALYTICS_V1')),
  enableReconciliation: toBoolean(readFlag('ENABLE_RECONCILIATION')),
  analyticsCacheTtlSeconds: Number(readFlag('ANALYTICS_V1_CACHE_TTL_SECONDS')) || 600,
});

module.exports = { featureFlags };
