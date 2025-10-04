// backend/routes/user.js
const express = require('express');
const bcrypt = require('bcryptjs');
const auth = require('../middleware/auth');
const User = require('../models/User');
const PaymentMethod = require('../models/PaymentMethod');

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
    roles: Array.isArray(u.roles) ? u.roles : ['user'],
    country: u.country || 'uk',
    emailVerified: !!u.emailVerified,
    subscription: u.subscription || { tier: 'free', status: 'inactive' },
    trial: u.trial || null,
    onboarding: u.onboarding || {},
    preferences: u.preferences || {},
    usageStats: u.usageStats || {},
    salaryNavigator: u.salaryNavigator || {},
    wealthPlan: u.wealthPlan || {},
    integrations: u.integrations || [],
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
  const {
    firstName,
    lastName,
    username,
    email,
    country,
    preferences,
    onboarding
  } = req.body || {};
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

    const existing = await User.findById(req.user.id);
    if (!existing) return res.status(404).json({ error: 'User not found' });
    const update = { firstName, lastName, email };
    if (typeof username === 'string') update.username = username;
    if (country && ['uk','us'].includes(country)) update.country = country;
    if (preferences && typeof preferences === 'object') {
      update.preferences = {
        ...(existing?.preferences?.toObject ? existing.preferences.toObject() : existing?.preferences || {}),
        ...preferences
      };
    }
    if (onboarding && typeof onboarding === 'object') {
      update.onboarding = {
        ...(existing?.onboarding?.toObject ? existing.onboarding.toObject() : existing?.onboarding || {}),
        ...onboarding
      };
    }

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

// GET /api/user/me/payment-methods
router.get('/me/payment-methods', auth, async (req, res) => {
  try {
    const methods = await PaymentMethod.find({ userId: req.user.id }).sort({ createdAt: -1 }).lean();
    res.json({ methods });
  } catch (e) {
    console.error('GET /user/me/payment-methods error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/user/preferences
router.patch('/preferences', auth, async (req, res) => {
  try {
    const { deltaMode, analyticsRange } = req.body || {};
    const update = {};
    if (deltaMode && ['absolute','percent'].includes(deltaMode)) {
      update['preferences.deltaMode'] = deltaMode;
    }
    if (analyticsRange && typeof analyticsRange === 'object') {
      update['preferences.analyticsRange'] = {
        preset: analyticsRange.preset || null,
        start: analyticsRange.start ? new Date(analyticsRange.start) : null,
        end: analyticsRange.end ? new Date(analyticsRange.end) : null
      };
    }
    const user = await User.findByIdAndUpdate(req.user.id, { $set: update }, { new: true });
    res.json({ preferences: user.preferences });
  } catch (e) {
    console.error('PATCH /user/preferences error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/user/onboarding
router.patch('/onboarding', auth, async (req, res) => {
  try {
    const { wizardCompleted, tourCompleted, goals } = req.body || {};
    const update = {};
    if (wizardCompleted) update['onboarding.wizardCompletedAt'] = new Date();
    if (tourCompleted) update['onboarding.tourCompletedAt'] = new Date();
    if (Array.isArray(goals)) update['onboarding.goals'] = goals.filter(Boolean);
    update['onboarding.lastPromptedAt'] = new Date();
    const user = await User.findByIdAndUpdate(req.user.id, { $set: update }, { new: true });
    res.json({ onboarding: user.onboarding });
  } catch (e) {
    console.error('PATCH /user/onboarding error:', e);
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

