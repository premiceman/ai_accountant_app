// backend/src/routes/auth.routes.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

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

router.post('/login', async (req, res) => {
  try {
    const { email, username, password } = req.body || {};
    if ((!email && !username) || !password) {
      return res.status(400).json({ error: 'Email/username and password are required' });
    }
    const query = email ? { email: String(email).toLowerCase().trim() } : { username: String(username).toLowerCase().trim() };
    const user = await User.findOne(query).lean(false);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const hashed = user.password;
    let ok = false;
    if (typeof hashed === 'string' && hashed.startsWith('$2')) ok = await bcrypt.compare(password, hashed);
    else ok = hashed === password;
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken(user);
    res.json({ ok: true, token, user: pickUser(user) });
  } catch (e) {
    console.error('auth/login error', e);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/signup', async (req, res) => {
  try {
    const { email, password, firstName, lastName, username } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const exists = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (exists) return res.status(409).json({ error: 'Email already registered' });
    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({
      email: String(email).toLowerCase().trim(),
      password: hash,
      firstName, lastName, username
    });
    const token = signToken(user);
    res.status(201).json({ ok: true, token, user: pickUser(user) });
  } catch (e) {
    console.error('auth/signup error', e);
    res.status(500).json({ error: 'Signup failed' });
  }
});

module.exports = router;
