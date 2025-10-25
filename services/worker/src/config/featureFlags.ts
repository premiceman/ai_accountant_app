// NOTE: Triage diagnostics for empty transactions (non-destructive). Remove after issue is resolved.
// NOTE: Hotfix — TS types for shared flags + FE v1 flip + staged loader + prefer-v1 legacy; aligns with Phase-1/2/3 specs. Additive, non-breaking.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type SharedFeatureFlagsModule = {
  ENABLE_AJV_STRICT: boolean;
  ENABLE_ANALYTICS_V1: boolean;
  ENABLE_ANALYTICS_LEGACY: boolean;
  ENABLE_FRONTEND_ANALYTICS_V1: boolean;
  ENABLE_QA_DEV_ENDPOINTS: boolean;
  ENABLE_RECONCILIATION: boolean;
  ENABLE_STAGED_LOADER_ANALYTICS: boolean;
  ENABLE_TRIAGE_LOGS: boolean;
  STRICT_METRICS_V1: boolean;
  featureFlags: {
    enableAnalyticsV1: boolean;
    enableReconciliation: boolean;
    analyticsCacheTtlSeconds: number;
    enableFrontendAnalyticsV1: boolean;
    enableAjvStrict: boolean;
    enableAnalyticsLegacy: boolean;
    enableStagedLoaderAnalytics: boolean;
    enableQaDevEndpoints: boolean;
    enableTriageLogs: boolean;
    strictMetricsV1: boolean;
  };
  getAllFlags(): Record<string, boolean>;
  getFlag(name: string): boolean;
  serialiseFlagsForClient(): {
    ENABLE_FRONTEND_ANALYTICS_V1: boolean;
    ENABLE_ANALYTICS_LEGACY: boolean;
    ENABLE_STAGED_LOADER_ANALYTICS: boolean;
  };
};

const require = createRequire(import.meta.url);

const featureFlagModulePath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'shared',
  'config',
  'featureFlags.js',
);

const sharedFeatureFlags = require(featureFlagModulePath) as SharedFeatureFlagsModule;

export const {
  ENABLE_AJV_STRICT,
  ENABLE_ANALYTICS_V1,
  ENABLE_ANALYTICS_LEGACY,
  ENABLE_FRONTEND_ANALYTICS_V1,
  ENABLE_QA_DEV_ENDPOINTS,
  ENABLE_RECONCILIATION,
  ENABLE_STAGED_LOADER_ANALYTICS,
  ENABLE_TRIAGE_LOGS,
  STRICT_METRICS_V1,
  featureFlags,
  getAllFlags,
  getFlag,
  serialiseFlagsForClient,
} = sharedFeatureFlags;

export default sharedFeatureFlags;
