// backend/routes/authCheck.js
const express = require('express');
const router = express.Router();

const SESSION_COOKIE = process.env.SESSION_COOKIE || 'sid';
const JWT_SECRET = process.env.JWT_SECRET; // if set, we verify JWT

// manual cookie parse (works even if cookie-parser isn't installed)
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

// lazy-load jsonwebtoken only if we need it
let jwt;
if (JWT_SECRET) {
  try { jwt = require('jsonwebtoken'); } catch { jwt = null; }
}

// GET /api/auth/check
router.get('/check', (req, res) => {
  const cookieToken = getCookie(req, SESSION_COOKIE);

  // Optional: allow Authorization: Bearer <token> too
  const auth = req.headers.authorization || '';
  const bearerToken = auth.startsWith('Bearer ') ? auth.slice(7) : null;

  const token = cookieToken || bearerToken;
  if (!token) return res.status(401).json({ ok: false });

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

  // Compatibility mode: treat cookie presence as authenticated
  return res.json({ ok: true, user: null });
});

module.exports = router;
