declare module '../../../shared/config/docupipe.js' {
  export const DEFAULT_DOCUPIPE_BASE_URL: string;
  export function resolveDocupipeBaseUrl(
    env?: Partial<Record<string, string | undefined>> | NodeJS.ProcessEnv
  ): string;
  export function assertDocupipeBaseUrl(url: string, source?: string | undefined): string;
}

declare module '../../../../shared/config/docupipe.js' {
  export const DEFAULT_DOCUPIPE_BASE_URL: string;
  export function resolveDocupipeBaseUrl(
    env?: Partial<Record<string, string | undefined>> | NodeJS.ProcessEnv
  ): string;
  export function assertDocupipeBaseUrl(url: string, source?: string | undefined): string;
}
