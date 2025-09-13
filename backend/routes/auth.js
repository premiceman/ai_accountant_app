// backend/routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const router = express.Router();

const TOKEN_TTL = process.env.JWT_EXPIRES_IN || '7d';
function issueToken(userId) {
  if (!process.env.JWT_SECRET) throw new Error('Missing JWT_SECRET');
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: TOKEN_TTL });
}

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    const { firstName, lastName, username, email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Missing email or password' });

    const normalisedEmail = String(email).toLowerCase().trim();
    const exists = await User.findOne({ email: normalisedEmail });
    if (exists) return res.status(400).json({ error: 'Email already registered' });

    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({
      firstName: firstName || '',
      lastName: lastName || '',
      username: username || '',
      email: normalisedEmail,
      passwordHash: hash,
    });

    const token = issueToken(user._id);
    const safe = user.toObject();
    delete safe.passwordHash;
    delete safe.password; // just in case any legacy docs had it
    return res.status(201).json({ token, user: safe });
  } catch (e) {
    console.error('Signup error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, username, password } = req.body || {};
    if (!password || (!email && !username)) {
      return res.status(400).json({ error: 'Missing credentials' });
    }

    const query = email
      ? { email: String(email).toLowerCase().trim() }
      : { username: String(username).trim() };

    // Select both, to be safe with any legacy data
    const user = await User.findOne(query).select('+passwordHash password');
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });

    const hash = user.passwordHash || user.password; // prefer passwordHash
    if (!hash) return res.status(500).json({ error: 'User record missing password' });

    const ok = await bcrypt.compare(password, hash);
    if (!ok) return res.status(400).json({ error: 'Invalid credentials' });

    const token = issueToken(user._id);
    const safe = user.toObject();
    delete safe.passwordHash;
    delete safe.password;

    return res.json({ token, user: safe });
  } catch (e) {
    console.error('Login error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;