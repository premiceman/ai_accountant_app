// backend/routes/integrations.js
const express = require('express');
const crypto = require('crypto');
const auth = require('../middleware/auth');
const User = require('../models/User');

const router = express.Router();

const VALID_STATUSES = ['not_connected','pending','error','connected'];

const CATALOG = [
  {
    key: 'truelayer',
    label: 'TrueLayer Open Banking',
    category: 'Bank connections',
    description: 'Launch a Revolut-style flow that lets individuals securely link their UK bank accounts in seconds.',
    env: ['TL_CLIENT_ID', 'TL_CLIENT_SECRET', 'TL_REDIRECT_URI'],
    docsUrl: 'https://docs.truelayer.com/',
    help: 'Set TL_CLIENT_ID, TL_CLIENT_SECRET, TL_REDIRECT_URI (and optionally TL_USE_SANDBOX) in Render. Once present, Phloat.io can open the familiar TrueLayer consent journey for instant account linking.'
  },
  {
    key: 'hmrc',
    label: 'HMRC Making Tax Digital',
    category: 'Government filings',
    description: 'Securely stream Self Assessment obligations and tax statements directly from HMRC.',
    comingSoon: true,
    docsUrl: 'https://developer.service.hmrc.gov.uk/',
    help: 'HMRC integrations require production approval and agent services enrolment. We will notify you as soon as the connection is ready to launch.'
  }
];

function normaliseKey(key) {
  return String(key || '').toLowerCase();
}

function findCatalogItem(key) {
  return CATALOG.find((item) => normaliseKey(item.key) === normaliseKey(key));
}

function normaliseStatus(status) {
  const val = normaliseKey(status);
  return VALID_STATUSES.includes(val) ? val : null;
}

function cataloguePayload() {
  return CATALOG.map((item) => {
    const requiredEnv = item.env || [];
    const missingEnv = requiredEnv.filter((name) => !process.env[name]);
    return {
      key: item.key,
      label: item.label,
      category: item.category,
      description: item.description,
      comingSoon: !!item.comingSoon,
      docsUrl: item.docsUrl || null,
      help: item.help || null,
      requiredEnv,
      missingEnv,
      envReady: missingEnv.length === 0,
      defaultStatus: item.comingSoon ? 'pending' : 'not_connected'
    };
  });
}

function ensureBaseIntegration(list, key, label) {
  const idx = list.findIndex((i) => normaliseKey(i.key) === normaliseKey(key));
  const existing = idx >= 0 ? list[idx] : null;
  const payload = {
    key: normaliseKey(key),
    label: label || existing?.label || key,
    status: 'connected',
    lastCheckedAt: new Date(),
    metadata: existing?.metadata || {}
  };
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...payload };
  } else {
    list.push(payload);
  }
}

function sanitiseInstitution(raw = {}) {
  return {
    id: String(raw.id || '').toLowerCase(),
    name: String(raw.name || '').trim(),
    brandColor: raw.brandColor || null,
    accentColor: raw.accentColor || null,
    icon: raw.icon || null,
    tagline: raw.tagline || null
  };
}

function buildConnectionKey(provider, slug) {
  return `${normaliseKey(provider)}:${String(slug).toLowerCase()}`;
}

function randomSuffix() {
  return crypto.randomBytes(5).toString('hex');
}

// GET /api/integrations
router.get('/', auth, async (req, res) => {
  const user = await User.findById(req.user.id).lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ integrations: user.integrations || [], catalog: cataloguePayload() });
});

// POST /api/integrations/:key/connections
router.post('/:key/connections', auth, async (req, res) => {
  const provider = normaliseKey(req.params.key);
  if (provider !== 'truelayer') {
    return res.status(404).json({ error: 'Unsupported integration provider' });
  }

  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const institution = sanitiseInstitution(req.body?.institution || {});
  if (!institution.id || !institution.name) {
    return res.status(400).json({ error: 'Institution details are required.' });
  }

  const accounts = Array.isArray(req.body?.accounts) ? req.body.accounts : [];
  const connectionId = `${institution.id}-${randomSuffix()}`;
  const key = buildConnectionKey(provider, connectionId);

  const list = Array.isArray(user.integrations) ? [...user.integrations] : [];
  ensureBaseIntegration(list, provider, 'TrueLayer Open Banking');

  if (list.some((i) => normaliseKey(i.key) === key)) {
    return res.status(400).json({ error: 'Connection already exists.' });
  }

  const payload = {
    key,
    label: institution.name,
    status: 'connected',
    lastCheckedAt: new Date(),
    metadata: {
      type: 'bank_connection',
      provider,
      connectionId,
      institution,
      accounts,
      notes: req.body?.notes || '',
      sandbox: process.env.TL_USE_SANDBOX === 'true',
      addedAt: new Date(),
      lastRefreshedAt: new Date(),
    }
  };

  list.push(payload);
  user.integrations = list;
  await user.save();

  res.json({ integration: payload, integrations: list, catalog: cataloguePayload() });
});

// POST /api/integrations/:key/renew
router.post('/:key/renew', auth, async (req, res) => {
  const integKey = normaliseKey(req.params.key);
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const list = Array.isArray(user.integrations) ? [...user.integrations] : [];
  const idx = list.findIndex((i) => normaliseKey(i.key) === integKey);
  if (idx < 0) return res.status(404).json({ error: 'Integration not found' });

  const now = new Date();
  const metadata = {
    ...(list[idx].metadata || {}),
    lastRefreshedAt: now,
    lastRenewalNote: req.body?.note || 'Renewed via dashboard'
  };

  list[idx] = {
    ...list[idx],
    status: 'connected',
    lastCheckedAt: now,
    metadata
  };

  user.integrations = list;
  await user.save();

  res.json({ integration: list[idx], integrations: list, catalog: cataloguePayload() });
});

// PUT /api/integrations/:key
router.put('/:key', auth, async (req, res) => {
  const { key } = req.params;
  const status = normaliseStatus(req.body?.status);
  if (!status) return res.status(400).json({ error: 'Invalid status' });

  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const integKey = normaliseKey(key);
  const catalogItem = findCatalogItem(integKey);
  if (catalogItem?.comingSoon && status === 'connected') {
    return res.status(400).json({ error: 'This integration is not yet available.' });
  }
  const list = Array.isArray(user.integrations) ? [...user.integrations] : [];
  const idx = list.findIndex((i) => normaliseKey(i.key) === integKey);
  const payload = {
    key: integKey,
    label: req.body?.label || catalogItem?.label || (idx >= 0 ? list[idx].label : key),
    status,
    lastCheckedAt: new Date(),
    metadata: req.body?.metadata || {}
  };
  if (idx >= 0) list[idx] = { ...list[idx], ...payload };
  else list.push(payload);

  const targetIdx = idx >= 0 ? idx : list.length - 1;
  if (integKey === 'truelayer') {
    const hasConnections = list.some((i) => normaliseKey(i.key).startsWith('truelayer:'));
    if (hasConnections) {
      list[targetIdx] = { ...list[targetIdx], status: 'connected' };
    }
  }

  user.integrations = list;
  await user.save();
  res.json({ integration: list[targetIdx], integrations: list });
});

// DELETE /api/integrations/:key
router.delete('/:key', auth, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const integKey = normaliseKey(req.params.key);
  const list = Array.isArray(user.integrations) ? [...user.integrations] : [];
  const filtered = list.filter((i) => normaliseKey(i.key) !== integKey);

  const removed = filtered.length !== list.length;
  if (!removed) {
    return res.status(404).json({ error: 'Integration not found' });
  }

  // If a TrueLayer bank connection was removed, ensure the root tile reflects remaining connections
  if (integKey.startsWith('truelayer:')) {
    const hasConnections = filtered.some((i) => normaliseKey(i.key).startsWith('truelayer:'));
    const baseIdx = filtered.findIndex((i) => normaliseKey(i.key) === 'truelayer');
    if (baseIdx >= 0) {
      filtered[baseIdx] = {
        ...filtered[baseIdx],
        status: hasConnections ? filtered[baseIdx].status : 'not_connected',
        lastCheckedAt: new Date()
      };
    }
  }

  user.integrations = filtered;
  await user.save();
  res.json({ ok: true, integrations: filtered, catalog: cataloguePayload() });
});

module.exports = router;
