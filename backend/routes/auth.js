// backend/routes/auth.js
const express = require('express');
// Use bcryptjs (pure JS) to avoid native build issues on hosts
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
  if (!u) return null;
  const plain = u.toObject ? u.toObject() : u;
  delete plain.passwordHash;
  delete plain.password; // legacy
  // Normalise legacy ‘professional’ for UI continuity
  if (plain.licenseTier === 'professional') plain.licenseTier = 'premium';
  return plain;
}

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    const { firstName, lastName, username, email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Missing email or password' });

    const normalisedEmail = String(email).toLowerCase().trim();
    const existingEmail = await User.findOne({ email: normalisedEmail });
    if (existingEmail) return res.status(409).json({ error: 'Email already in use' });

    if (username) {
      const existingU = await User.findOne({ username: String(username).trim() });
      if (existingU) return res.status(409).json({ error: 'Username already in use' });
    }

    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({
      firstName: firstName || '',
      lastName: lastName || '',
      username: username ? String(username).trim() : undefined,
      email: normalisedEmail,
      passwordHash: hash,
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

    const query = email
      ? { email: String(email).toLowerCase().trim() }
      : { username: String(username).trim() };

    // Select both to tolerate legacy docs with `password`
    const user = await User.findOne(query).select('+passwordHash password');
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });

    const hash = user.passwordHash || user.password;
    if (!hash) return res.status(500).json({ error: 'User record missing password' });

    const ok = await bcrypt.compare(password, hash);
    if (!ok) return res.status(400).json({ error: 'Invalid credentials' });

    const token = issueToken(user._id);
    return res.json({ token, user: toPublicUser(user) });
  } catch (e) {
    console.error('Login error:', e && e.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

