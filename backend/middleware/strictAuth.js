// backend/middleware/strictAuth.js
const path = require('path');

function wantsHtml(req) {
  const a = (req.headers.accept || '').toLowerCase();
  return a.includes('text/html') || a === '' || a === '*/*';
}
function isGuestish(user) {
  const id = String(user?.id || '').toLowerCase();
  const role = String(user?.role || '').toLowerCase();
  const bad = ['guest','anonymous','anon','public'];
  return bad.includes(id) || bad.includes(role);
}

/**
 * Require an attached, non-guest req.user.
 * Does NOT verify tokens (auth.js does that). Only enforces presence.
 */
function requireRealUser(req, res, next) {
  if (req.user && !isGuestish(req.user)) return next();

  if (wantsHtml(req)) {
    res.status(401).sendFile(path.join(__dirname, '../../frontend/unauthorized.html'));
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

module.exports = { requireRealUser };
