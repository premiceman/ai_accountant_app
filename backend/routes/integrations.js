// backend/routes/integrations.js
const express = require('express');
const auth = require('../middleware/auth');
const User = require('../models/User');

const router = express.Router();

const VALID_STATUSES = ['not_connected','pending','error','connected'];

function normaliseKey(key) {
  return String(key || '').toLowerCase();
}

function normaliseStatus(status) {
  const val = normaliseKey(status);
  return VALID_STATUSES.includes(val) ? val : null;
}

// GET /api/integrations
router.get('/', auth, async (req, res) => {
  const user = await User.findById(req.user.id).lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ integrations: user.integrations || [] });
});

// PUT /api/integrations/:key
router.put('/:key', auth, async (req, res) => {
  const { key } = req.params;
  const status = normaliseStatus(req.body?.status);
  if (!status) return res.status(400).json({ error: 'Invalid status' });

  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const integKey = normaliseKey(key);
  const list = Array.isArray(user.integrations) ? [...user.integrations] : [];
  const idx = list.findIndex((i) => normaliseKey(i.key) === integKey);
  const payload = {
    key: integKey,
    label: req.body?.label || (idx >= 0 ? list[idx].label : key),
    status,
    lastCheckedAt: new Date(),
    metadata: req.body?.metadata || {}
  };
  if (idx >= 0) list[idx] = { ...list[idx], ...payload };
  else list.push(payload);

  user.integrations = list;
  await user.save();
  res.json({ integration: payload, integrations: list });
});

// DELETE /api/integrations/:key
router.delete('/:key', auth, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const integKey = normaliseKey(req.params.key);
  user.integrations = (user.integrations || []).filter((i) => normaliseKey(i.key) !== integKey);
  await user.save();
  res.json({ ok: true });
});

module.exports = router;
