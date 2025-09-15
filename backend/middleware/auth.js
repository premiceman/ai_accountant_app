// backend/middleware/auth.js
let jwt;
try { jwt = require('jsonwebtoken'); } catch { jwt = null; }

function parseCookies(cookieHeader = '') {
  return cookieHeader.split(';').reduce((acc, part) => {
    const i = part.indexOf('=');
    if (i === -1) return acc;
    const k = part.slice(0, i).trim();
    const v = decodeURIComponent(part.slice(i + 1).trim());
    acc[k] = v; return acc;
  }, {});
}

function tryVerify(token) {
  if (!token || !jwt) return null;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'change-me');
    const id = String(payload.sub || payload.id || payload._id || '');
    if (!id) return null;
    return {
      id,
      email: payload.email,
      role: payload.role || payload.scope || 'user',
    };
  } catch { return null; }
}

/**
 * Populate req.user from Authorization Bearer OR cookie token (token/jwt/accessToken).
 * Does NOT send responses; just attaches req.user when valid.
 */
function auth(req, _res, next) {
  // 1) Bearer first (if present)
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (m) {
    const u = tryVerify(m[1]);
    if (u) { req.user = u; return next(); }
    // If header existed but was invalid, still try cookies before giving up.
  }

  // 2) Cookie token (if you use httpOnly cookie sessions that store a JWT)
  const cookies = parseCookies(req.headers.cookie || '');
  const cookieToken = cookies.token || cookies.jwt || cookies.accessToken;
  const u2 = tryVerify(cookieToken);
  if (u2) { req.user = u2; return next(); }

  // 3) Nothing to attach — leave req.user unset; downstream gate will 401.
  return next();
}

module.exports = auth;
