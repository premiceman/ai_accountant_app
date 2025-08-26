// backend/routes/profile.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');

// Allowed editable fields (server allowlist)
const EDITABLE_FIELDS = new Set(['firstName', 'lastName', 'email', 'phone', 'address']);

// GET /api/user/me  (auth required)
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password -__v');
    if (!user) return res.status(404).json({ error: 'User not found' });

    return res.json({
      id: user.id,
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      username: user.username || '',
      email: user.email,
      phone: user.phone || '',
      address: user.address || '',
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      role: user.role || 'user'
    });
  } catch (e) {
    console.error('GET /api/user/me error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/user/me  (auth required)
router.put('/me', auth, async (req, res) => {
  try {
    // Pick & trim only allowlisted fields
    const updates = {};
    for (const [k, v] of Object.entries(req.body || {})) {
      if (EDITABLE_FIELDS.has(k) && typeof v === 'string') {
        updates[k] = v.trim();
      }
    }

    // Minimal validation
    if (!updates.firstName || updates.firstName.length > 60)
      return res.status(400).json({ error: 'Invalid first name' });
    if (!updates.lastName || updates.lastName.length > 60)
      return res.status(400).json({ error: 'Invalid last name' });
    if (!updates.email || !/^\S+@\S+\.\S+$/.test(updates.email) || updates.email.length > 120)
      return res.status(400).json({ error: 'Invalid email' });
    if (updates.phone && updates.phone.length > 30)
      return res.status(400).json({ error: 'Invalid phone' });
    if (updates.address && updates.address.length > 200)
      return res.status(400).json({ error: 'Invalid address' });

    const existing = await User.findById(req.user.id);
    if (!existing) return res.status(404).json({ error: 'User not found' });

    // Enforce unique email if changed
    let forceReauth = false;
    if (updates.email && updates.email !== existing.email) {
      const emailInUse = await User.findOne({ email: updates.email });
      if (emailInUse && String(emailInUse._id) !== String(req.user.id)) {
        return res.status(409).json({ error: 'Email already in use' });
      }
      forceReauth = true; // require fresh login after email change
    }

    Object.assign(existing, updates, { updatedAt: new Date() });
    const saved = await existing.save();

    return res.json({
      user: {
        id: saved.id,
        firstName: saved.firstName || '',
        lastName: saved.lastName || '',
        username: saved.username || '',
        email: saved.email,
        phone: saved.phone || '',
        address: saved.address || '',
        createdAt: saved.createdAt,
        updatedAt: saved.updatedAt,
        role: saved.role || 'user'
      },
      forceReauth
    });
  } catch (e) {
    console.error('PUT /api/user/me error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
