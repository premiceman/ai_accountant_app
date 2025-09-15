// backend/routes/authCheck.js
const express = require('express');
const router = express.Router();

const SESSION_COOKIE = process.env.SESSION_COOKIE || 'sid';
const JWT_SECRET = process.env.JWT_SECRET; // if set, we verify; if not, we just check presence

// Lazy import jwt only if used
let jwt;
if (JWT_SECRET) {
  try { jwt = require('jsonwebtoken'); } catch { jwt = null; }
}

// GET /api/auth/check
router.get('/check', (req, res) => {
  const cookieToken = req.cookies && req.cookies[SESSION_COOKIE];

  // Optional Bearer fallback
  const auth = req.headers.authorization || '';
  const bearerToken = auth.startsWith('Bearer ') ? auth.slice(7) : null;

  const token = cookieToken || bearerToken;
  if (!token) return res.status(401).json({ ok: false });

  // If a JWT secret is configured and jsonwebtoken is available, verify the token
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
    } catch (_e) {
      return res.status(401).json({ ok: false });
    }
  }

  // Else: accept presence of cookie as logged-in (compatibility mode)
  return res.json({ ok: true, user: null });
});

module.exports = router;
