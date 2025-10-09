// NOTE: Hotfix — TS types for shared flags + FE v1 flip + staged loader + prefer-v1 legacy; aligns with Phase-1/2/3 specs. Additive, non-breaking.
declare module '../../../shared/config/featureFlags.js' {
  export const ENABLE_AJV_STRICT: boolean;
  export const ENABLE_ANALYTICS_V1: boolean;
  export const ENABLE_ANALYTICS_LEGACY: boolean;
  export const ENABLE_FRONTEND_ANALYTICS_V1: boolean;
  export const ENABLE_STAGED_LOADER_ANALYTICS: boolean;
  export const ENABLE_QA_DEV_ENDPOINTS: boolean;
  export const ENABLE_RECONCILIATION: boolean;
  export function getFlag(name: string): boolean;
  export function getAllFlags(): Record<string, boolean>;
  export function serialiseFlagsForClient(): {
    ENABLE_FRONTEND_ANALYTICS_V1: boolean;
    ENABLE_ANALYTICS_LEGACY: boolean;
    ENABLE_STAGED_LOADER_ANALYTICS: boolean;
  };
}

declare module '../../../../shared/config/featureFlags.js' {
  export const ENABLE_AJV_STRICT: boolean;
  export const ENABLE_ANALYTICS_V1: boolean;
  export const ENABLE_ANALYTICS_LEGACY: boolean;
  export const ENABLE_FRONTEND_ANALYTICS_V1: boolean;
  export const ENABLE_STAGED_LOADER_ANALYTICS: boolean;
  export const ENABLE_QA_DEV_ENDPOINTS: boolean;
  export const ENABLE_RECONCILIATION: boolean;
  export function getFlag(name: string): boolean;
  export function getAllFlags(): Record<string, boolean>;
  export function serialiseFlagsForClient(): {
    ENABLE_FRONTEND_ANALYTICS_V1: boolean;
    ENABLE_ANALYTICS_LEGACY: boolean;
    ENABLE_STAGED_LOADER_ANALYTICS: boolean;
  };
}
