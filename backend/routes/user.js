// backend/routes/user.js
const express = require('express');
const bcrypt = require('bcryptjs');
const auth = require('../middleware/auth');
const User = require('../models/User');

const router = express.Router();

function publicUser(u) {
  if (!u) return null;
  return {
    id: u._id,
    firstName: u.firstName || '',
    lastName: u.lastName || '',
    username: u.username || '',
    email: u.email,
    licenseTier: u.licenseTier === 'professional' ? 'premium' : (u.licenseTier || 'free'),
    createdAt: u.createdAt,
    updatedAt: u.updatedAt
  };
}

// GET /api/user/me
router.get('/me', auth, async (req, res) => {
  try {
    const u = await User.findById(req.user.id).lean();
    if (!u) return res.status(404).json({ error: 'Not found' });
    return res.json({ user: publicUser(u) });
  } catch (e) {
    console.error('GET /user/me error:', e && e.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/user/me (kept as in your file)
router.put('/me', auth, async (req, res) => {
  const { firstName, lastName, username, email } = req.body || {};
  if (!firstName || !lastName || !email) {
    return res.status(400).json({ error: 'firstName, lastName and email are required' });
  }
  try {
    if (email) {
      const exists = await User.findOne({ email, _id: { $ne: req.user.id } }).lean();
      if (exists) return res.status(400).json({ error: 'Email already in use' });
    }
    if (username) {
      const existsU = await User.findOne({ username, _id: { $ne: req.user.id } }).lean();
      if (existsU) return res.status(400).json({ error: 'Username already in use' });
    }
    const updated = await User.findByIdAndUpdate(
      req.user.id,
      { $set: { firstName, lastName, username, email } },
      { new: true, runValidators: true }
    ).lean();
    return res.json({ user: publicUser(updated) });
  } catch (e) {
    console.error('PUT /user/me error:', e && e.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/user/change-password
router.post('/change-password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body || {};
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ error: 'All password fields are required' });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'New password and confirmation do not match' });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const u = await User.findById(req.user.id).select('+passwordHash password');
    if (!u || (!u.passwordHash && !u.password)) {
      return res.status(400).json({ error: 'Invalid account' });
    }

    const currentHash = u.passwordHash || u.password;
    let ok = false;
    try {
      ok = (typeof currentHash === 'string' && currentHash.startsWith('$2')) ? await bcrypt.compare(currentPassword, currentHash) : false;
    } catch { ok = false; }
    if (!ok) return res.status(400).json({ error: 'Current password is incorrect' });

    const hash = await bcrypt.hash(newPassword, 10);
    u.passwordHash = hash;                                     // <-- FIXED
    await u.save({ validateModifiedOnly: true });              // <-- avoid unrelated validators

    return res.json({ ok: true, message: 'Password updated' });
  } catch (e) {
    console.error('POST /user/change-password error:', e && e.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

