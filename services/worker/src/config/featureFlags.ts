// NOTE: Triage diagnostics for empty transactions (non-destructive). Remove after issue is resolved.
// NOTE: Hotfix — TS types for shared flags + FE v1 flip + staged loader + prefer-v1 legacy; aligns with Phase-1/2/3 specs. Addi
// tive, non-breaking.
import sharedFeatureFlags from '../shared/featureFlagsProxy.js';

type SharedFeatureFlagsModule = {
  ENABLE_AJV_STRICT: boolean;
  ENABLE_ANALYTICS_V1: boolean;
  ENABLE_ANALYTICS_LEGACY: boolean;
  ENABLE_FRONTEND_ANALYTICS_V1: boolean;
  ENABLE_QA_DEV_ENDPOINTS: boolean;
  ENABLE_RECONCILIATION: boolean;
  ENABLE_STAGED_LOADER_ANALYTICS: boolean;
  ENABLE_TRIAGE_LOGS: boolean;
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
  };
  getAllFlags(): Record<string, boolean>;
  getFlag(name: string): boolean;
  serialiseFlagsForClient(): {
    ENABLE_FRONTEND_ANALYTICS_V1: boolean;
    ENABLE_ANALYTICS_LEGACY: boolean;
    ENABLE_STAGED_LOADER_ANALYTICS: boolean;
  };
};

const typedFeatureFlags = sharedFeatureFlags as SharedFeatureFlagsModule;

export const {
  ENABLE_AJV_STRICT,
  ENABLE_ANALYTICS_V1,
  ENABLE_ANALYTICS_LEGACY,
  ENABLE_FRONTEND_ANALYTICS_V1,
  ENABLE_QA_DEV_ENDPOINTS,
  ENABLE_RECONCILIATION,
  ENABLE_STAGED_LOADER_ANALYTICS,
  ENABLE_TRIAGE_LOGS,
  featureFlags,
  getAllFlags,
  getFlag,
  serialiseFlagsForClient,
} = typedFeatureFlags;

export default typedFeatureFlags;
