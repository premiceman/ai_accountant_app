// backend/middleware/csrf.js
const {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  SESSION_COOKIE_NAME,
  readCookies,
} = require('../utils/session');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const cookies = readCookies(req);
  const hasSession = Boolean(cookies?.[SESSION_COOKIE_NAME]);
  if (!hasSession) {
    return next();
  }

  const cookieToken = cookies?.[CSRF_COOKIE_NAME];
  const headerToken = req.get(CSRF_HEADER_NAME) || req.get(CSRF_HEADER_NAME.toUpperCase());

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'CSRF token mismatch' });
  }

  return next();
}

module.exports = csrfProtection;
