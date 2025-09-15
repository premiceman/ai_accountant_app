// backend/routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const router = express.Router();

const TOKEN_TTL      = process.env.JWT_EXPIRES_IN || '7d';
const JWT_SECRET     = process.env.JWT_SECRET || 'change-me';
const LEGAL_VERSION  = process.env.LEGAL_VERSION || '2025-09-15';
const SESSION_COOKIE = process.env.SESSION_COOKIE || 'sid';
const CROSS_SITE     = String(process.env.CROSS_SITE || '').toLowerCase() === 'true';

const cookieOpts = {
  httpOnly: true,
  secure: true,
  sameSite: CROSS_SITE ? 'none' : 'lax',
  path: '/',
  maxAge: 1000 * 60 * 60 * 24 * 7
};

function issueToken(user) {
  return jwt.sign(
    { sub: String(user._id), id: String(user._id), email: user.email, name: [user.firstName, user.lastName].filter(Boolean).join(' ') },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u._id, uid: u.uid, firstName: u.firstName || '', lastName: u.lastName || '',
    username: u.username || '', email: u.email || '', dateOfBirth: u.dateOfBirth || null,
    licenseTier: u.licenseTier || 'free', eulaAcceptedAt: u.eulaAcceptedAt || null,
    eulaVersion: u.eulaVersion || null, createdAt: u.createdAt, updatedAt: u.updatedAt,
  };
}
const normEmail = (x) => String(x || '').trim().toLowerCase();
const normUsername = (x) => String(x || '').trim();
const isValidEmail = (x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(x || ''));

// Fallback cookie parse
function getCookie(req, name) {
  if (req.cookies && Object.prototype.hasOwnProperty.call(req.cookies, name)) return req.cookies[name];
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const p = part.trim();
    const i = p.indexOf('=');
    if (i > -1 && p.slice(0, i) === name) return decodeURIComponent(p.slice(i + 1));
  }
  return undefined;
}

/** GET /api/auth/check
 *  - With ?email/username → availability
 *  - Without → session check (cookie or Bearer)
 */
router.get('/check', async (req, res) => {
  try {
    const hasAvail = ('email' in req.query) || ('username' in req.query);
    if (hasAvail) {
      const email = req.query.email ? normEmail(req.query.email) : null;
      const username = req.query.username ? normUsername(req.query.username) : null;
      const out = {};
      if (email)    out.emailAvailable = !(await User.exists({ email }));
      if (username) out.usernameAvailable = !(await User.exists({ username }));
      if (!email && !username) return res.status(400).json({ error: 'email or username required' });
      return res.json(out);
    }

    const cookieToken = getCookie(req, SESSION_COOKIE);
    const auth = req.headers.authorization || '';
    const bearerToken = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const token = cookieToken || bearerToken;
    if (!token) return res.status(401).json({ ok: false });

    try {
      const payload = jwt.verify(token, JWT_SECRET);
      return res.json({ ok: true, user: { id: payload.sub || payload.id, email: payload.email, name: payload.name } });
    } catch {
      return res.status(401).json({ ok: false });
    }
  } catch (e) {
    console.error('GET /auth/check error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/signup', async (req, res) => {
  try {
    const { firstName, lastName, username, email, password, passwordConfirm, dateOfBirth, agreeLegal, legalVersion } = req.body || {};
    if (!firstName || !lastName || !email || !password || !passwordConfirm || !dateOfBirth) return res.status(400).json({ error: 'Missing required fields' });
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email address' });
    if (String(password) !== String(passwordConfirm)) return res.status(400).json({ error: 'Passwords do not match' });
    if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const dob = new Date(String(dateOfBirth));
    if (isNaN(dob.getTime())) return res.status(400).json({ error: 'Invalid date of birth' });
    if (dob >= new Date()) return res.status(400).json({ error: 'Date of birth must be in the past' });
    if (!agreeLegal) return res.status(400).json({ error: 'You must agree to the Terms to create an account' });

    const emailN = normEmail(email);
    const userN  = normUsername(username);
    const [emailExists, usernameExists] = await Promise.all([
      User.exists({ email: emailN }),
      userN ? User.exists({ username: userN }) : Promise.resolve(null),
    ]);
    if (emailExists)    return res.status(409).json({ error: 'Email already registered' });
    if (usernameExists) return res.status(409).json({ error: 'Username already in use' });

    const hash = await bcrypt.hash(String(password), 10);
    const user = new User({
      firstName: String(firstName).trim(),
      lastName:  String(lastName).trim(),
      username:  userN || '',
      email:     emailN,
      password:  hash,
      dateOfBirth: dob,
      eulaAcceptedAt: new Date(),
      eulaVersion: String(legalVersion || LEGAL_VERSION),
    });
    await user.save();

    const token = issueToken(user);
    res.cookie(SESSION_COOKIE, token, cookieOpts);
    return res.status(201).json({ ok: true, token, user: publicUser(user) });
  } catch (e) {
    console.error('Signup error:', e);
    if (e?.code === 11000) {
      if (e.keyPattern?.email)    return res.status(409).json({ error: 'Email already registered' });
      if (e.keyPattern?.username) return res.status(409).json({ error: 'Username already in use' });
      if (e.keyPattern?.uid)      return res.status(500).json({ error: 'Failed to allocate user id; please retry' });
    }
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Missing credentials' });

    const user = await User.findOne({ email: normEmail(email) });
    if (!user || !user.password) return res.status(400).json({ error: 'Invalid credentials' });

    if (!user.uid) { user.uid = undefined; await user.save(); }

    const ok = await bcrypt.compare(String(password), user.password);
    if (!ok) return res.status(400).json({ error: 'Invalid credentials' });

    const token = issueToken(user);
    res.cookie(SESSION_COOKIE, token, cookieOpts);
    return res.json({ ok: true, token, user: publicUser(user) });
  } catch (e) {
    console.error('Login error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE, { ...cookieOpts, maxAge: 0 });
  res.json({ ok: true });
});

module.exports = router;
