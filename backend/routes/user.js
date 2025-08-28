const express = require('express');
const User = require('../models/User');
const auth = require('../middleware/auth');

const router = express.Router();
const EDITABLE = new Set(['firstName','lastName','email','phone','address']);

// GET /api/user/me  -> current user only
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password -__v');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (e) {
    console.error('GET /me error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/user/me -> current user only
router.put('/me', auth, async (req, res) => {
  try {
    const updates = {};
    for (const [k, v] of Object.entries(req.body || {})) {
      if (EDITABLE.has(k) && typeof v === 'string') updates[k] = v.trim();
    }
    if ('email' in updates) {
      const exists = await User.findOne({ email: updates.email.toLowerCase() });
      if (exists && String(exists._id) !== String(req.user.id)) {
        return res.status(409).json({ error: 'Email already in use' });
      }
    }
    const doc = await User.findByIdAndUpdate(req.user.id, { $set: updates }, { new: true, select: '-password -__v' });
    if (!doc) return res.status(404).json({ error: 'User not found' });
    res.json(doc);
  } catch (e) {
    console.error('PUT /me error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
