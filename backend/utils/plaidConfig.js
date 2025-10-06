// backend/utils/plaidConfig.js
const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');

function parseList(str, fallback = []) {
  if (!str) return fallback;
  const parts = String(str)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : fallback;
}

const DEFAULT_PRODUCTS = ['transactions'];
const DEFAULT_COUNTRIES = ['GB', 'US'];

const plaidEnvName = (process.env.PLAID_ENV || 'sandbox').toLowerCase();
const plaidEnv = PlaidEnvironments[plaidEnvName] || PlaidEnvironments.sandbox;
const isSandbox = plaidEnvName === 'sandbox' || plaidEnvName === 'development';

const allowLive = (() => {
  const raw = String(process.env.PLAID_ENV_OVERRIDE || '').toLowerCase();
  if (!raw) return false;
  return ['true', '1', 'allow', 'live', 'production', 'enable'].includes(raw);
})();

const productScopes = {
  link: parseList(process.env.PLAID_PRODUCTS, DEFAULT_PRODUCTS),
  transactions: parseList(process.env.PLAID_TRANSACTIONS_PRODUCTS, DEFAULT_PRODUCTS),
};

const countryCodes = parseList(process.env.PLAID_COUNTRY_CODES, DEFAULT_COUNTRIES);

const syncFreshnessMs = Number(process.env.PLAID_SYNC_FRESHNESS_MS || 5 * 60 * 1000);

let plaidClient;

function getPlaidClient() {
  if (isSandbox) {
    return null; // sandbox mode does not call out to Plaid
  }
  if (plaidClient) return plaidClient;

  if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
    console.warn('⚠️  PLAID_CLIENT_ID/PLAID_SECRET not fully configured. Plaid routes will fail until set.');
  }

  const configuration = new Configuration({
    basePath: plaidEnv,
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID || '',
        'PLAID-SECRET': process.env.PLAID_SECRET || '',
      },
    },
  });

  plaidClient = new PlaidApi(configuration);
  return plaidClient;
}

module.exports = {
  plaidEnvName,
  plaidEnv,
  isSandbox,
  allowLive,
  productScopes,
  countryCodes,
  syncFreshnessMs,
  getPlaidClient,
  parseList,
};
