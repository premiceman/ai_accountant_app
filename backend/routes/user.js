// backend/routes/user.js
const express = require('express');
const bcrypt = require('bcryptjs');
const auth = require('../middleware/auth');
const User = require('../models/User');

const router = express.Router();

// Utility: shape user data for client (don't expose password/hash)
function publicUser(u) {
  if (!u) return null;
  return {
    id: u._id,
    firstName: u.firstName || '',
    lastName: u.lastName || '',
    username: u.username || '',
    email: u.email || '',
    dateOfBirth: u.dateOfBirth || null,
    licenseTier: u.licenseTier || 'free',
    eulaAcceptedAt: u.eulaAcceptedAt || null,
    eulaVersion: u.eulaVersion || null,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt
  };
}

// GET /api/user/me
router.get('/me', auth, async (req, res) => {
  const u = await User.findById(req.user.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  res.json(publicUser(u));
});

// PUT /api/user/me  (update your own profile)
router.put('/me', auth, async (req, res) => {
  const { firstName, lastName, username, email } = req.body || {};
  if (!firstName || !lastName || !email) {
    return res.status(400).json({ error: 'firstName, lastName and email are required' });
  }

  try {
    // Check for unique email/username conflicts (excluding self)
    if (email) {
      const exists = await User.findOne({ email, _id: { $ne: req.user.id } }).lean();
      if (exists) return res.status(400).json({ error: 'Email already in use' });
    }
    if (username) {
      const existsU = await User.findOne({ username, _id: { $ne: req.user.id } }).lean();
      if (existsU) return res.status(400).json({ error: 'Username already in use' });
    }

    const update = { firstName, lastName, email };
    if (typeof username === 'string') update.username = username;

    const updated = await User.findByIdAndUpdate(
      req.user.id,
      { $set: update },
      { new: true }
    );
    res.json(publicUser(updated));
  } catch (e) {
    console.error('PUT /user/me error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/user/change-password
router.post('/change-password', auth, async (req, res) => {
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

  try {
    const u = await User.findById(req.user.id);
    if (!u || !u.password) return res.status(400).json({ error: 'Invalid account' });

    const ok = await bcrypt.compare(currentPassword, u.password);
    if (!ok) return res.status(400).json({ error: 'Current password is incorrect' });

    const hash = await bcrypt.hash(newPassword, 10);
    u.password = hash;
    await u.save();

    res.json({ ok: true, message: 'Password updated' });
  } catch (e) {
    console.error('POST /user/change-password error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

