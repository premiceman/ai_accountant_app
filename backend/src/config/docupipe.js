// backend/src/config/docupipe.ts
const rawBase = (process.env.DOCUPIPE_BASE_URL ?? 'https://app.docupipe.ai').trim();
const base = new URL(rawBase);
const DOCUPIPE_BASE_URL = base.origin; // guarantee host-only (no path, no trailing slash)

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing ${name}`);
  }
  return String(value).trim();
}

const DOCUPIPE_WORKFLOW_ID = requireEnv('DOCUPIPE_WORKFLOW_ID');
const DOCUPIPE_API_KEY = requireEnv('DOCUPIPE_API_KEY');
const PAYSLIP_SCHEMA_ID = requireEnv('PAYSLIP_SCHEMA_ID');
const BANK_STATEMENT_SCHEMA_ID = requireEnv('BANK_STATEMENT_SCHEMA_ID');

const DOCUPIPE_CONNECT_TIMEOUT_MS = Number(
  process.env.DOCUPIPE_CONNECT_TIMEOUT_MS || 30000
);

const config = {
  docupipe: {
    baseUrl: DOCUPIPE_BASE_URL,
    apiKey: DOCUPIPE_API_KEY,
    workflowId: DOCUPIPE_WORKFLOW_ID,
    connectTimeoutMs: DOCUPIPE_CONNECT_TIMEOUT_MS,
    payslipSchemaId: PAYSLIP_SCHEMA_ID,
    bankStatementSchemaId: BANK_STATEMENT_SCHEMA_ID,
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
  PAYSLIP_SCHEMA_ID,
  BANK_STATEMENT_SCHEMA_ID,
  docupipeUrl,
  config,
};
