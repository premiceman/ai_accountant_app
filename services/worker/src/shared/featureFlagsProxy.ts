import * as sharedFeatureFlagsModule from '../../../../shared/config/featureFlags.js';

type SharedFeatureFlagsModuleShape = typeof sharedFeatureFlagsModule & {
  default?: typeof sharedFeatureFlagsModule;
};

const moduleCandidate = sharedFeatureFlagsModule as SharedFeatureFlagsModuleShape;
const sharedFeatureFlags = (moduleCandidate.default ?? moduleCandidate) as typeof sharedFeatureFlagsModule;

export default sharedFeatureFlags;
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
} = sharedFeatureFlags;
