declare const sharedFeatureFlags: {
  ENABLE_AJV_STRICT: boolean;
  ENABLE_ANALYTICS_V1: boolean;
  ENABLE_ANALYTICS_LEGACY: boolean;
  ENABLE_FRONTEND_ANALYTICS_V1: boolean;
  ENABLE_STAGED_LOADER_ANALYTICS: boolean;
  ENABLE_QA_DEV_ENDPOINTS: boolean;
  ENABLE_RECONCILIATION: boolean;
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
  getFlag(name: string): boolean;
  getAllFlags(): Record<string, boolean>;
  serialiseFlagsForClient(): {
    ENABLE_FRONTEND_ANALYTICS_V1: boolean;
    ENABLE_ANALYTICS_LEGACY: boolean;
    ENABLE_STAGED_LOADER_ANALYTICS: boolean;
  };
};

export = sharedFeatureFlags;
export default sharedFeatureFlags;
