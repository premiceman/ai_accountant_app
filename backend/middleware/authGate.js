// backend/middleware/authGate.js
const path = require('path');

function isLikelyApiClient(req) {
  const accept = (req.headers.accept || '').toLowerCase();
  const xrw = (req.headers['x-requested-with'] || '').toLowerCase();
  return accept.includes('application/json') || xrw === 'xmlhttprequest';
}

function hasAnyAuthToken(req) {
  const h = req.headers.authorization || '';
  const cookie = req.headers.cookie || '';
  return /^bearer\s+/i.test(h) || /(?:^|;\s*)(sid|token)=/i.test(cookie);
}

/**
 * If authenticated → next()
 * If not:
 *   - Browser (Accept: text/html) → 401 + pretty unauthorized page
 *   - API/XHR → 401 JSON
 */
function requireAuthOrHtmlUnauthorized(req, res, next) {
  const authed = !!req.user || hasAnyAuthToken(req);
  if (authed) return next();

  // Return pretty page for browsers
  if (!isLikelyApiClient(req)) {
    const htmlPath = path.join(__dirname, '../../frontend/unauthorized.html');
    res.status(401);
    return res.sendFile(htmlPath);
  }

  // Return JSON for API clients
  res.status(401).json({ error: 'Unauthorized' });
}

module.exports = { requireAuthOrHtmlUnauthorized };
