// backend/src/config/docupipe.ts
const rawBase = (process.env.DOCUPIPE_BASE_URL ?? 'https://app.docupipe.ai').trim();
const base = new URL(rawBase);
const DOCUPIPE_BASE_URL = base.origin; // guarantee host-only (no path, no trailing slash)

const DOCUPIPE_WORKFLOW_ID =
  process.env.DOCUPIPE_WORKFLOW_ID || (() => { throw new Error('Missing DOCUPIPE_WORKFLOW_ID'); })();

const DOCUPIPE_API_KEY =
  process.env.DOCUPIPE_API_KEY || (() => { throw new Error('Missing DOCUPIPE_API_KEY'); })();

const DOCUPIPE_CONNECT_TIMEOUT_MS = Number(
  process.env.DOCUPIPE_CONNECT_TIMEOUT_MS || 30000
);

const config = {
  docupipe: {
    baseUrl: DOCUPIPE_BASE_URL,
    apiKey: DOCUPIPE_API_KEY,
    workflowId: DOCUPIPE_WORKFLOW_ID,
    connectTimeoutMs: DOCUPIPE_CONNECT_TIMEOUT_MS,
  },
};

function docupipeUrl(path) {
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

module.exports = {
  DOCUPIPE_BASE_URL,
  DOCUPIPE_WORKFLOW_ID,
  docupipeUrl,
  config,
};
