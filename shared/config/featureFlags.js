// NOTE: Triage diagnostics for empty transactions (non-destructive). Remove after issue is resolved.
// NOTE: Hotfix — TS types for shared flags + FE v1 flip + staged loader + prefer-v1 legacy; aligns with Phase-1/2/3 specs. Additive, non-breaking.
'use strict';

const DEFAULTS = Object.freeze({
  ENABLE_ANALYTICS_V1: 'true',
  ENABLE_RECONCILIATION: 'false',
  ANALYTICS_V1_CACHE_TTL_SECONDS: '600',
  ENABLE_FRONTEND_ANALYTICS_V1: 'true',
  ENABLE_AJV_STRICT: 'false',
  ENABLE_ANALYTICS_LEGACY: 'true',
  ENABLE_STAGED_LOADER_ANALYTICS: 'true',
  ENABLE_QA_DEV_ENDPOINTS: 'false',
  ENABLE_TRIAGE_LOGS: 'false',
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
    enableQaDevEndpoints: toBoolean(readFlag('ENABLE_QA_DEV_ENDPOINTS')),
    enableTriageLogs: toBoolean(readFlag('ENABLE_TRIAGE_LOGS')),
  });
}

const featureFlags = buildFeatureFlags();

function serialiseFlagsForClient() {
  return {
    ENABLE_FRONTEND_ANALYTICS_V1: featureFlags.enableFrontendAnalyticsV1,
    ENABLE_ANALYTICS_LEGACY: featureFlags.enableAnalyticsLegacy,
    ENABLE_STAGED_LOADER_ANALYTICS: featureFlags.enableStagedLoaderAnalytics,
    JSON_TEST_ENABLED: toBoolean(process.env.JSON_TEST),
  };
}

const FLAG_NAME_MAP = Object.freeze({
  ENABLE_ANALYTICS_V1: 'enableAnalyticsV1',
  ENABLE_RECONCILIATION: 'enableReconciliation',
  ENABLE_FRONTEND_ANALYTICS_V1: 'enableFrontendAnalyticsV1',
  ENABLE_AJV_STRICT: 'enableAjvStrict',
  ENABLE_ANALYTICS_LEGACY: 'enableAnalyticsLegacy',
  ENABLE_STAGED_LOADER_ANALYTICS: 'enableStagedLoaderAnalytics',
  ENABLE_QA_DEV_ENDPOINTS: 'enableQaDevEndpoints',
  ENABLE_TRIAGE_LOGS: 'enableTriageLogs',
});

function getFlag(name) {
  const key = FLAG_NAME_MAP[name];
  if (key && Object.prototype.hasOwnProperty.call(featureFlags, key)) {
    return Boolean(featureFlags[key]);
  }
  return toBoolean(readFlag(name));
}

function getAllFlags() {
  return Object.keys(FLAG_NAME_MAP).reduce((acc, name) => {
    acc[name] = getFlag(name);
    return acc;
  }, {});
}

module.exports = {
  DEFAULTS,
  featureFlags,
  buildFeatureFlags,
  serialiseFlagsForClient,
  getFlag,
  getAllFlags,
  ENABLE_ANALYTICS_V1: featureFlags.enableAnalyticsV1,
  ENABLE_RECONCILIATION: featureFlags.enableReconciliation,
  ENABLE_FRONTEND_ANALYTICS_V1: featureFlags.enableFrontendAnalyticsV1,
  ENABLE_AJV_STRICT: featureFlags.enableAjvStrict,
  ENABLE_ANALYTICS_LEGACY: featureFlags.enableAnalyticsLegacy,
  ENABLE_STAGED_LOADER_ANALYTICS: featureFlags.enableStagedLoaderAnalytics,
  ENABLE_QA_DEV_ENDPOINTS: featureFlags.enableQaDevEndpoints,
  ENABLE_TRIAGE_LOGS: featureFlags.enableTriageLogs,
  toBoolean,
  toNumber,
  readFlag,
};
