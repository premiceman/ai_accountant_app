const assert = require('node:assert');
const {
  DOCUPIPE_BASE_URL,
  DOCUPIPE_WORKFLOW_ID,
  config: docupipeBaseConfig,
} = require('../config/docupipe');

function requireEnv(name) {
  const value = process.env[name];
  assert(value, `Missing required env var ${name}`);
  return value;
}

function optionalEnv(name, fallback = null) {
  const value = process.env[name];
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  return value;
}

const config = {
  app: {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: Number(process.env.PORT || 3000),
    publicUrl: optionalEnv('PUBLIC_URL', 'http://localhost:3000'),
  },
  mongo: {
    uri: requireEnv('MONGODB_URI'),
  },
  r2: {
    accountId: requireEnv('R2_ACCOUNT_ID'),
    accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
    bucket: requireEnv('R2_BUCKET'),
    endpoint: requireEnv('R2_S3_ENDPOINT'),
    publicHost: optionalEnv('R2_PUBLIC_HOST'),
  },
  docupipe: {
    baseUrl: docupipeBaseConfig?.docupipe?.baseUrl || DOCUPIPE_BASE_URL,
    workflowId: docupipeBaseConfig?.docupipe?.workflowId || DOCUPIPE_WORKFLOW_ID,
    dataset: optionalEnv('DOCUPIPE_DATASET'),
    apiKey: docupipeBaseConfig?.docupipe?.apiKey || requireEnv('DOCUPIPE_API_KEY'),
    payslipSchemaId:
      docupipeBaseConfig?.docupipe?.payslipSchemaId || requireEnv('PAYSLIP_SCHEMA_ID'),
    bankStatementSchemaId:
      docupipeBaseConfig?.docupipe?.bankStatementSchemaId || requireEnv('BANK_STATEMENT_SCHEMA_ID'),
    connectTimeoutMs:
      docupipeBaseConfig?.docupipe?.connectTimeoutMs
      || Number(optionalEnv('DOCUPIPE_CONNECT_TIMEOUT_MS', '30000')),
    maxInFlight: Number(optionalEnv('MAX_DOCUPIPE_IN_FLIGHT', '3')),
    pollIntervalMs: Number(optionalEnv('DOCUPIPE_POLL_INTERVAL_MS', '1500')),
    pollTimeoutMs: Number(optionalEnv('DOCUPIPE_POLL_TIMEOUT_MS', '120000')),
  },
  openai: {
    apiKey: requireEnv('OPENAI_API_KEY'),
    model: optionalEnv('OPENAI_ADVICE_MODEL', 'gpt-4o-mini'),
    promptVersion: optionalEnv('OPENAI_ADVICE_PROMPT_VERSION', 'v1'),
  },
};

module.exports = { config, requireEnv, optionalEnv };
