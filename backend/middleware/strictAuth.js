// backend/middleware/strictAuth.js
const path = require('path');
let jwt;
try { jwt = require('jsonwebtoken'); } catch { jwt = null; }

function wantsHtml(req) {
  const a = (req.headers.accept || '').toLowerCase();
  return a.includes('text/html') || a === '' || a === '*/*';
}

function htmlUnauthorized(res) {
  res.status(401).sendFile(path.join(__dirname, '../../frontend/unauthorized.html'));
}

function jsonUnauthorized(res) {
  res.status(401).json({ error: 'Unauthorized' });
}

function extractToken(req) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1];

  // cookie fallback: token=<jwt>
  const cookie = req.headers.cookie || '';
  const cm = cookie.match(/(?:^|;\s*)token=([^;]+)/i);
  if (cm) return decodeURIComponent(cm[1]);

  return null;
}

/**
 * Require a valid JWT or a previously-attached req.user.
 * If missing/invalid:
 *  - for browsers → serve pretty Unauthorized page (401)
 *  - for API/XHR → JSON 401
 */
function requireAuthStrict(req, res, next) {
  // If upstream middleware already attached a verified user, accept it.
  if (req.user && req.user.id) return next();

  const token = extractToken(req);
  if (!token) return wantsHtml(req) ? htmlUnauthorized(res) : jsonUnauthorized(res);

  if (!jwt) {
    // jsonwebtoken not installed → deny by default (secure)
    return wantsHtml(req) ? htmlUnauthorized(res) : jsonUnauthorized(res);
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'change-me');
    // normalize fields
    req.user = {
      id: String(payload.sub || payload.id || payload._id || ''),
      email: payload.email,
      role: payload.role || payload.scope || 'user'
    };
    if (!req.user.id) return wantsHtml(req) ? htmlUnauthorized(res) : jsonUnauthorized(res);
    // hard block any "guest" style identities if they sneak in
    const lid = (req.user.id || '').toLowerCase();
    const lrole = (req.user.role || '').toLowerCase();
    const isGuest = ['guest','anonymous','anon','public'].includes(lid) || ['guest','anonymous','anon','public'].includes(lrole);
    if (isGuest) return wantsHtml(req) ? htmlUnauthorized(res) : jsonUnauthorized(res);

    next();
  } catch {
    return wantsHtml(req) ? htmlUnauthorized(res) : jsonUnauthorized(res);
  }
}

module.exports = { requireAuthStrict };
