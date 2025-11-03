// services/worker/src/config/docupipe.ts
const rawBase = (process.env.DOCUPIPE_BASE_URL ?? 'https://app.docupipe.ai').trim();
const base = new URL(rawBase);
export const DOCUPIPE_BASE_URL = base.origin; // guarantee host-only (no path, no trailing slash)

export const DOCUPIPE_WORKFLOW_ID =
  process.env.DOCUPIPE_WORKFLOW_ID || (() => { throw new Error('Missing DOCUPIPE_WORKFLOW_ID'); })();

export function docupipeUrl(path: string): string {
  // path must start with '/'
  return new URL(path, DOCUPIPE_BASE_URL).toString();
}

// Helpful startup logs (keys redacted elsewhere)
if (base.pathname !== '/' || /\/workflows\//.test(rawBase)) {
  // eslint-disable-next-line no-console
  console.warn(`[Docupipe] Normalized base URL from "${rawBase}" to origin "${DOCUPIPE_BASE_URL}"`);
}
// eslint-disable-next-line no-console
console.log('[Docupipe] Base:', DOCUPIPE_BASE_URL);
