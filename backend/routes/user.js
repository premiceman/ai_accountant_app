// backend/routes/user.js
const express = require('express');

// Prefer native 'bcrypt' if present; otherwise fall back to 'bcryptjs'
let bcrypt;
try { bcrypt = require('bcrypt'); } catch { bcrypt = require('bcryptjs'); }

const jwt = require('jsonwebtoken');
const User = require('../models/User');

const router = express.Router();

function requireEnv() {
  ['JWT_SECRET'].forEach((k) => {
    if (!process.env[k]) throw new Error(`Missing required env: ${k}`);
  });
}

// Minimal auth middleware: accepts JWT in cookie 'token' or 'Authorization: Bearer <jwt>'
function auth(req, res, next) {
  try {
    requireEnv();
    const header = req.get('authorization') || '';
    const bearer = header.toLowerCase().startsWith('bearer ')
      ? header.slice(7).trim()
      : null;
    const cookieToken = req.cookies && req.cookies.token;
    const token = bearer || cookieToken;
    if (!token) return res.status(401).json({ error: 'Unauthorised' });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.id };
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
}

// GET /api/user/me
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).lean();
    if (!user) return res.status(404).json({ error: 'Not found' });
    delete user.passwordHash;
    delete user.password;
    return res.json({ user });
  } catch (e) {
    console.error('Me error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/user/change-password
router.post('/change-password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Missing password(s)' });
    }
    const user = await User.findById(req.user.id).select('+passwordHash password');
    if (!user) return res.status(404).json({ error: 'Not found' });

    const hash = user.passwordHash || user.password;
    if (!hash) return res.status(500).json({ error: 'User record missing password' });

    const ok = await bcrypt.compare(currentPassword, hash);
    if (!ok) return res.status(400).json({ error: 'Incorrect current password' });

    const newHash = await bcrypt.hash(newPassword, 10);
    user.passwordHash = newHash;

    // Save only modified fields; avoid validating unrelated legacy fields
    await user.save({ validateModifiedOnly: true });

    return res.json({ ok: true });
  } catch (e) {
    console.error('Change-password error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

