// backend/src/routes/auth.routes.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../../models/User');

const router = express.Router();

function signToken(user) {
  const payload = { id: String(user._id), email: user.email };
  const secret = process.env.JWT_SECRET || 'dev_secret_change_me';
  const expiresIn = process.env.JWT_EXPIRES || '7d';
  return jwt.sign(payload, secret, { expiresIn });
}

function pickUser(u) {
  return {
    id: String(u._id),
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    username: u.username,
    role: u.role || 'user'
  };
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, username, password } = req.body || {};
    if ((!email && !username) || !password) {
      return res.status(400).json({ error: 'Email/username and password are required' });
    }
    const query = email
      ? { email: String(email).toLowerCase().trim() }
      : { username: String(username).toLowerCase().trim() };

    const user = await User.findOne(query).lean(false);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const hashed = user.password;
    let ok = false;
    if (typeof hashed === 'string' && hashed.startsWith('$2')) {
      ok = await bcrypt.compare(password, hashed);
    } else {
      // fallback for plaintext in dev databases
      ok = hashed === password;
    }
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken(user);
    return res.json({ ok: true, token, user: pickUser(user) });
  } catch (e) {
    console.error('auth/login error', e);
    return res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/me  (Authorization: Bearer <token>)
router.get('/me', async (req, res) => {
  try {
    const hdr = req.headers.authorization || '';
    const m = hdr.match(/^Bearer\s+(.+)$/i);
    if (!m) return res.status(401).json({ error: 'Missing token' });
    const token = m[1];
    const secret = process.env.JWT_SECRET || 'dev_secret_change_me';
    const decoded = jwt.verify(token, secret);
    const user = await User.findById(decoded.id).lean();
    if (!user) return res.status(404).json({ error: 'Not found' });
    return res.json(pickUser(user));
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
});

module.exports = router;
