// NOTE: Phase-3 — Frontend uses /api/analytics/v1, staged loader on dashboards, Ajv strict. Rollback via flags.
'use strict';

const DEFAULTS = Object.freeze({
  ENABLE_ANALYTICS_V1: 'true',
  ENABLE_RECONCILIATION: 'false',
  ANALYTICS_V1_CACHE_TTL_SECONDS: '600',
  ENABLE_FRONTEND_ANALYTICS_V1: 'true',
  ENABLE_AJV_STRICT: 'true',
  ENABLE_ANALYTICS_LEGACY: 'false',
  ENABLE_STAGED_LOADER_ANALYTICS: 'true',
});

function readFlag(name) {
  const raw = process.env[name];
  if (raw == null || raw === '') return DEFAULTS[name];
  return raw;
}

function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (value == null) return false;
  const normalised = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalised)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalised)) return false;
  return false;
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function buildFeatureFlags() {
  return Object.freeze({
    enableAnalyticsV1: toBoolean(readFlag('ENABLE_ANALYTICS_V1')),
    enableReconciliation: toBoolean(readFlag('ENABLE_RECONCILIATION')),
    analyticsCacheTtlSeconds: toNumber(readFlag('ANALYTICS_V1_CACHE_TTL_SECONDS'), 600),
    enableFrontendAnalyticsV1: toBoolean(readFlag('ENABLE_FRONTEND_ANALYTICS_V1')),
    enableAjvStrict: toBoolean(readFlag('ENABLE_AJV_STRICT')),
    enableAnalyticsLegacy: toBoolean(readFlag('ENABLE_ANALYTICS_LEGACY')),
    enableStagedLoaderAnalytics: toBoolean(readFlag('ENABLE_STAGED_LOADER_ANALYTICS')),
  });
}

const featureFlags = buildFeatureFlags();

function serialiseFlagsForClient() {
  return {
    enableFrontendAnalyticsV1: featureFlags.enableFrontendAnalyticsV1,
    enableAnalyticsLegacy: featureFlags.enableAnalyticsLegacy,
    enableStagedLoaderAnalytics: featureFlags.enableStagedLoaderAnalytics,
  };
}

module.exports = {
  DEFAULTS,
  featureFlags,
  buildFeatureFlags,
  serialiseFlagsForClient,
  toBoolean,
  toNumber,
  readFlag,
};
