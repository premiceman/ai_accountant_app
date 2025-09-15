// backend/middleware/authGate.js
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME';
const SESSION_COOKIE = process.env.SESSION_COOKIE || 'sid';

let jwt;
try { jwt = require('jsonwebtoken'); } catch { jwt = null; }

// Tiny cookie parser fallback (works even without cookie-parser)
function getCookie(req, name) {
  if (req.cookies && Object.prototype.hasOwnProperty.call(req.cookies, name)) {
    return req.cookies[name];
  }
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const p = part.trim();
    const i = p.indexOf('=');
    if (i > -1 && p.slice(0, i) === name) return decodeURIComponent(p.slice(i + 1));
  }
  return undefined;
}

function extractToken(req) {
  const cookieToken = getCookie(req, SESSION_COOKIE);
  const auth = req.headers.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  return cookieToken || bearer || null;
}

function attachAuth(req, _res, next) {
  const token = extractToken(req);
  if (!token || !jwt) { req.auth = null; return next(); }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.auth = {
      userId: String(payload.sub || payload.id || ''),
      email: payload.email || undefined,
      name: payload.name || undefined,
      token
    };
    req.userId = req.auth.userId; // compatibility
  } catch {
    req.auth = null;
    req.userId = undefined;
  }
  next();
}

function wantsHtml(req) {
  const a = (req.headers.accept || '').toLowerCase();
  return a.includes('text/html') || a === '*/*' || a === '';
}

function requireAuth(req, res, next) {
  attachAuth(req, res, () => {
    if (!req.auth || !req.auth.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  });
}

// Used where your routes might return HTML; otherwise use requireAuth.
function requireAuthOrHtmlUnauthorized(req, res, next) {
  attachAuth(req, res, () => {
    if (!req.auth || !req.auth.userId) {
      if (wantsHtml(req)) return res.status(401).send('<!doctype html><h1>401 Unauthorized</h1>');
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  });
}

module.exports = { attachAuth, requireAuth, requireAuthOrHtmlUnauthorized };
