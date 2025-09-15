// backend/routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const router = express.Router();

const TOKEN_TTL  = process.env.JWT_EXPIRES_IN || '2h';
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';

const issueToken = (userId) => jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: TOKEN_TTL });

function publicUser(u) {
  if (!u) return null;
  return {
    id: u._id,
    uid: u.uid,
    firstName: u.firstName || '',
    lastName: u.lastName || '',
    username: u.username || '',
    email: u.email || '',
    dateOfBirth: u.dateOfBirth || null,
    licenseTier: u.licenseTier || 'free',
    eulaAcceptedAt: u.eulaAcceptedAt || null,
    eulaVersion: u.eulaVersion || null,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

function normEmail(x) { return String(x || '').trim().toLowerCase(); }
function normUsername(x) { return String(x || '').trim(); }
function isValidEmail(x) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(x || ''));
}

// GET /api/auth/check?email=&username=   (availability check; no auth)
router.get('/check', async (req, res) => {
  try {
    const email    = req.query.email ? normEmail(req.query.email) : null;
    const username = req.query.username ? normUsername(req.query.username) : null;

    const out = {};
    if (email) {
      const exists = await User.exists({ email });
      out.emailAvailable = !exists;
    }
    if (username) {
      const exists = await User.exists({ username });
      out.usernameAvailable = !exists;
    }
    if (!email && !username) return res.status(400).json({ error: 'email or username required' });
    res.json(out);
  } catch (e) {
    console.error('GET /auth/check error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    const {
      firstName, lastName, username, email,
      password, passwordConfirm,
      dateOfBirth // ISO yyyy-mm-dd preferred from <input type="date">
    } = req.body || {};

    // Required checks
    if (!firstName || !lastName || !email || !password || !passwordConfirm || !dateOfBirth) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    if (String(password) !== String(passwordConfirm)) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // DOB validation: real date, must be in the past
    const dob = new Date(String(dateOfBirth));
    if (isNaN(dob.getTime())) {
      return res.status(400).json({ error: 'Invalid date of birth' });
    }
    const now = new Date();
    if (dob >= now) {
      return res.status(400).json({ error: 'Date of birth must be in the past' });
    }

    const emailN = normEmail(email);
    const userN  = normUsername(username);

    // Availability checks
    const [emailExists, usernameExists] = await Promise.all([
      User.exists({ email: emailN }),
      userN ? User.exists({ username: userN }) : Promise.resolve(null),
    ]);
    if (emailExists) return res.status(409).json({ error: 'Email already registered' });
    if (usernameExists) return res.status(409).json({ error: 'Username already in use' });

    const hash = await bcrypt.hash(String(password), 10);
    const user = new User({
      firstName: String(firstName).trim(),
      lastName:  String(lastName).trim(),
      username:  userN || '',
      email:     emailN,
      password:  hash,
      dateOfBirth: dob,
      // uid auto-generates
    });
    await user.save();

    const token = issueToken(user._id);
    res.status(201).json({ token, user: publicUser(user) });
  } catch (e) {
    console.error('Signup error:', e);
    // Handle duplicate key errors defensively
    if (e?.code === 11000) {
      if (e.keyPattern?.email)    return res.status(409).json({ error: 'Email already registered' });
      if (e.keyPattern?.username) return res.status(409).json({ error: 'Username already in use' });
      if (e.keyPattern?.uid)      return res.status(500).json({ error: 'Failed to allocate user id; please retry' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Missing credentials' });

    const user = await User.findOne({ email: normEmail(email) });
    if (!user || !user.password) return res.status(400).json({ error: 'Invalid credentials' });

    // Backfill uid if missing
    if (!user.uid) { user.uid = undefined; await user.save(); }

    const ok = await bcrypt.compare(String(password), user.password);
    if (!ok) return res.status(400).json({ error: 'Invalid credentials' });

    const token = issueToken(user._id);
    res.json({ token, user: publicUser(user) });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
