// backend/routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const router = express.Router();
const TOKEN_TTL = process.env.JWT_EXPIRES_IN || '2h';

function requireEnv() {
  if (!process.env.JWT_SECRET) throw new Error('Missing required env: JWT_SECRET');
}
function issueToken(userId) {
  requireEnv();
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: TOKEN_TTL });
}
function toPublicUser(u) {
  const o = u.toObject();
  delete o.passwordHash;
  delete o.password; // tolerate any legacy field
  if (o.licenseTier === 'professional') o.licenseTier = 'premium';
  return o;
}

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    const { firstName, lastName, username, email, password } = req.body || {};
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const normalisedEmail = String(email).toLowerCase().trim();
    if (await User.findOne({ email: normalisedEmail })) {
      return res.status(409).json({ error: 'Email already in use' });
    }
    if (username && await User.findOne({ username })) {
      return res.status(409).json({ error: 'Username already in use' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      firstName, lastName, username,
      email: normalisedEmail,
      passwordHash: hashedPassword,          // <-- FIXED
    });

    const token = issueToken(user._id);
    return res.status(201).json({ token, user: toPublicUser(user) });
  } catch (e) {
    console.error('Signup error:', e && e.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    requireEnv();
    const { email, username, password } = req.body || {};
    const identifier = (email || username || '').toString().trim();
    if (!identifier || !password) {
      return res.status(400).json({ error: 'Please provide email/username and password' });
    }

    const query = email ? { email: String(email).toLowerCase().trim() } : { username: String(username).trim() };
    const user = await User.findOne(query).select('+passwordHash password'); // <-- tolerate legacy
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });

    const hash = user.passwordHash || user.password;
    if (!hash) return res.status(500).json({ error: 'User record missing password' });

    // Defensive compare: treat malformed hashes as invalid credentials
    let ok = false;
    try {
      ok = (typeof hash === 'string' && hash.startsWith('$2')) ? await bcrypt.compare(password, hash) : false;
    } catch (cmpErr) {
      console.error('bcrypt compare failed:', cmpErr && cmpErr.message);
      ok = false;
    }
    if (!ok) return res.status(400).json({ error: 'Invalid credentials' });

    const token = issueToken(user._id);
    return res.json({ token, user: toPublicUser(user) });
  } catch (e) {
    console.error('Login error:', e && e.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
