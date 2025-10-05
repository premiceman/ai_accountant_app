// backend/services/truelayer.js
const crypto = require('crypto');

const AUTH_BASE = process.env.TL_USE_SANDBOX === 'true'
  ? 'https://auth.truelayer-sandbox.com'
  : 'https://auth.truelayer.com';

const API_BASE = process.env.TL_USE_SANDBOX === 'true'
  ? 'https://api.truelayer-sandbox.com'
  : 'https://api.truelayer.com';

function createCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function createCodeChallenge(codeVerifier) {
  const hash = crypto.createHash('sha256').update(codeVerifier).digest('base64');
  return hash.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function getAuthBase() {
  return AUTH_BASE;
}

function getApiBase() {
  return API_BASE;
}

function buildAuthUrl(params) {
  const base = getAuthBase();
  const query = new URLSearchParams(params);
  return `${base}/?${query.toString()}`;
}

async function exchangeCodeForToken({ code, redirectUri, codeVerifier }) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: process.env.TL_CLIENT_ID,
    client_secret: process.env.TL_CLIENT_SECRET,
    redirect_uri: redirectUri,
    code,
    code_verifier: codeVerifier
  });

  const res = await fetch(`${getAuthBase()}/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TrueLayer token exchange failed (${res.status}): ${text}`);
  }

  return res.json();
}

async function fetchAccounts(accessToken) {
  const res = await fetch(`${getApiBase()}/data/v1/accounts`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TrueLayer accounts fetch failed (${res.status}): ${text}`);
  }
  const payload = await res.json();
  return Array.isArray(payload?.results) ? payload.results : [];
}

async function fetchInfo(accessToken) {
  const res = await fetch(`${getApiBase()}/data/v1/info`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TrueLayer info fetch failed (${res.status}): ${text}`);
  }
  const payload = await res.json();
  return payload?.results ? payload.results[0] : null;
}

module.exports = {
  createCodeVerifier,
  createCodeChallenge,
  getAuthBase,
  getApiBase,
  buildAuthUrl,
  exchangeCodeForToken,
  fetchAccounts,
  fetchInfo
};
