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
    console.error('GET /user/me error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/user/change-password
router.post('/change-password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Missing password(s)' });
    }

    const u = await User.findById(req.user.id).select('+passwordHash password');
    if (!u) return res.status(404).json({ error: 'Not found' });

    const currentHash = u.passwordHash || u.password;
    if (!currentHash) return res.status(500).json({ error: 'User record missing password' });

    const ok = await bcrypt.compare(currentPassword, currentHash);
    if (!ok) return res.status(400).json({ error: 'Current password is incorrect' });

    const hash = await bcrypt.hash(newPassword, 10);
    u.passwordHash = hash;

    await u.save({ validateModifiedOnly: true });
    return res.json({ ok: true, message: 'Password updated' });
  } catch (e) {
    console.error('POST /user/change-password error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
