// backend/utils/session.js
const crypto = require('crypto');

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'phloat_session';
const CSRF_COOKIE_NAME = process.env.CSRF_COOKIE_NAME || 'phloat_csrf';
const CSRF_HEADER_NAME = 'x-csrf-token';
const SESSION_COOKIE_DOMAIN = process.env.SESSION_COOKIE_DOMAIN || process.env.COOKIE_DOMAIN || undefined;
const SESSION_COOKIE_PATH = '/';

const SHORT_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const LONG_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function parseCookieHeader(header) {
  if (typeof header !== 'string' || !header) return {};
  return header.split(';').reduce((acc, part) => {
    const [rawKey, ...rest] = part.split('=');
    const key = rawKey ? rawKey.trim() : '';
    if (!key) return acc;
    const value = rest.join('=').trim();
    try {
      acc[key] = decodeURIComponent(value);
    } catch {
      acc[key] = value;
    }
    return acc;
  }, {});
}

function readCookies(req) {
  if (!req) return {};
  if (req.cookies && typeof req.cookies === 'object') {
    return req.cookies;
  }
  const header = req.headers && req.headers.cookie;
  if (!header) return {};
  return parseCookieHeader(header);
}

function buildSessionCookieOptions({ remember = false } = {}) {
  const maxAge = remember ? LONG_SESSION_TTL_MS : SHORT_SESSION_TTL_MS;
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: SESSION_COOKIE_PATH,
    domain: SESSION_COOKIE_DOMAIN,
    maxAge,
  };
}

function buildCsrfCookieOptions({ remember = false } = {}) {
  const maxAge = remember ? LONG_SESSION_TTL_MS : SHORT_SESSION_TTL_MS;
  return {
    httpOnly: false,
    secure: true,
    sameSite: 'lax',
    path: SESSION_COOKIE_PATH,
    domain: SESSION_COOKIE_DOMAIN,
    maxAge,
  };
}

function issueSessionCookies(res, token, { remember = false } = {}) {
  if (!res || typeof res.cookie !== 'function') return null;
  const sessionOptions = buildSessionCookieOptions({ remember });
  res.cookie(SESSION_COOKIE_NAME, token, sessionOptions);

  const csrfToken = crypto.randomBytes(24).toString('hex');
  const csrfOptions = buildCsrfCookieOptions({ remember });
  res.cookie(CSRF_COOKIE_NAME, csrfToken, csrfOptions);

  return { csrfToken, maxAge: sessionOptions.maxAge };
}

function clearSessionCookies(res) {
  if (!res || typeof res.clearCookie !== 'function') return;
  const baseOptions = {
    path: SESSION_COOKIE_PATH,
    domain: SESSION_COOKIE_DOMAIN,
    secure: true,
    sameSite: 'lax',
  };
  res.clearCookie(SESSION_COOKIE_NAME, baseOptions);
  res.clearCookie(CSRF_COOKIE_NAME, baseOptions);
}

function extractSessionToken(req) {
  if (!req) return null;
  const cookies = readCookies(req);
  if (cookies && cookies[SESSION_COOKIE_NAME]) {
    return cookies[SESSION_COOKIE_NAME];
  }
  return null;
}

const SESSION_COOKIE_OPTIONS = {
  SHORT_SESSION_TTL_MS,
  LONG_SESSION_TTL_MS,
};

module.exports = {
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  SESSION_COOKIE_OPTIONS,
  issueSessionCookies,
  clearSessionCookies,
  extractSessionToken,
  buildSessionCookieOptions,
  buildCsrfCookieOptions,
  readCookies,
  parseCookieHeader,
};
