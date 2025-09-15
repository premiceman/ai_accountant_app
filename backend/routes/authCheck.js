// backend/routes/authCheck.js
const express = require('express');
const router = express.Router();

const SESSION_COOKIE = process.env.SESSION_COOKIE || 'sid';
const JWT_SECRET = process.env.JWT_SECRET; // if set, we verify JWT

// manual cookie parse (when cookie-parser isn't installed)
function getCookie(req, name) {
  // if cookie-parser is present:
  if (req.cookies && Object.prototype.hasOwnProperty.call(req.cookies, name)) {
    return req.cookies[name];
  }
  // fallback: parse header
  const raw = req.headers.cookie || '';
  const parts = raw.split(';').map(s => s.trim());
  for (const p of parts) {
    const i = p.indexOf('=');
    if (i > -1) {
      const k = p.slice(0, i);
      const v = decodeURIComponent(p.slice(i + 1));
      if (k === name) return v;
    }
  }
  return undefined;
}

// lazy-load jsonwebtoken only if we need it
let jwt;
if (JWT_SECRET) {
  try { jwt = require('jsonwebtoken'); } catch { jwt = null; }
}

// GET /api/auth/check
router.get('/check', (req, res) => {
  const cookieToken = getCookie(req, SESSION_COOKIE);

  // Optional Bearer fallback
  const auth = req.headers.authorization || '';
  const bearerToken = auth.startsWith('Bearer ') ? auth.slice(7) : null;

  const token = cookieToken || bearerToken;
  if (!token) return res.status(401).json({ ok: false });

  // If we have a secret & jsonwebtoken, verify; otherwise accept presence
  if (JWT_SECRET && jwt) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      return res.json({
        ok: true,
        user: {
          id: payload.sub || payload.id,
          email: payload.email,
          name: payload.name
        }
      });
    } catch {
      return res.status(401).json({ ok: false });
    }
  }

  // Compatibility mode: cookie presence = authenticated
  return res.json({ ok: true, user: null });
});

module.exports = router;
