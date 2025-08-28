const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const router = express.Router();
const TOKEN_TTL = process.env.JWT_EXPIRES_IN || '2h';
const issueToken = (userId) => jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: TOKEN_TTL });

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    const { firstName, lastName, username, email, password } = req.body || {};
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const existingEmail = await User.findOne({ email: email.toLowerCase() });
    if (existingEmail) return res.status(409).json({ error: 'Email already in use' });
    if (username) {
      const existingU = await User.findOne({ username });
      if (existingU) return res.status(409).json({ error: 'Username already in use' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ firstName, lastName, username, email, password: hashedPassword });
    const token = issueToken(user._id);
    const safe = user.toObject(); delete safe.password;
    res.status(201).json({ token, user: safe });
  } catch (e) {
    console.error('Signup error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, username, password } = req.body || {};
    const identifier = (email || username || '').toString().trim();
    if (!identifier || !password) {
      return res.status(400).json({ error: 'Please provide email/username and password' });
    }
    const query = email ? { email: email.toLowerCase() } : { username };
    const user = await User.findOne(query);
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });
    if (!user.password) return res.status(500).json({ error: 'User record missing password' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ error: 'Invalid credentials' });
    const token = issueToken(user._id);
    const safe = user.toObject(); delete safe.password;
    res.json({ token, user: safe });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
