// backend/routes/integrations.js
const express = require('express');
const crypto = require('crypto');
const auth = require('../middleware/auth');
const User = require('../models/User');
const {
  VALID_STATUSES,
  normaliseKey,
  normaliseStatus,
  ensureBaseIntegration,
  sanitiseInstitution,
  buildConnectionKey,
  randomSuffix,
  pruneSessions
} = require('../utils/integrationHelpers');
const {
  createCodeVerifier,
  createCodeChallenge,
  buildAuthUrl
} = require('../services/truelayer');

const router = express.Router();

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

function findCatalogItem(key) {
  return CATALOG.find((item) => normaliseKey(item.key) === normaliseKey(key));
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

function redactIntegration(integration) {
  if (!integration) return integration;
  const clone = { ...integration };
  if (integration.metadata) {
    clone.metadata = { ...integration.metadata };
    if (integration.metadata.credentials) {
      const creds = integration.metadata.credentials;
      clone.metadata.credentials = {
        tokenType: creds.tokenType || creds.token_type || 'Bearer',
        expiresAt: creds.expiresAt || creds.expires_at || null,
        refreshable: Boolean(creds.refreshToken || creds.refresh_token)
      };
    }
  }
  return clone;
}

// GET /api/integrations
router.get('/', auth, async (req, res) => {
  const user = await User.findById(req.user.id).lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  const integrations = Array.isArray(user.integrations) ? user.integrations.map(redactIntegration) : [];
  res.json({ integrations, catalog: cataloguePayload() });
});

// POST /api/integrations/truelayer/launch
router.post('/truelayer/launch', auth, async (req, res) => {
  const requiredEnv = ['TL_CLIENT_ID', 'TL_CLIENT_SECRET', 'TL_REDIRECT_URI'];
  const missingEnv = requiredEnv.filter((name) => !process.env[name]);
  if (missingEnv.length) {
    return res.status(400).json({
      error: 'TrueLayer credentials missing',
      missingEnv
    });
  }

  const redirectUri = process.env.TL_REDIRECT_URI;
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const institution = sanitiseInstitution(req.body?.institution || {});
  const scopesInput = Array.isArray(req.body?.scopes) ? req.body.scopes : [];
  const scopes = scopesInput
    .map((scope) => String(scope || '').trim())
    .filter(Boolean);
  if (!scopes.length) {
    scopes.push('accounts');
    scopes.push('balance');
    scopes.push('transactions');
    scopes.push('info');
    scopes.push('offline_access');
  }

  const codeVerifier = createCodeVerifier();
  const codeChallenge = createCodeChallenge(codeVerifier);
  const stateToken = crypto.randomBytes(18).toString('hex');
  const state = `${user.uid}.${stateToken}`;

  const params = {
    response_type: 'code',
    client_id: process.env.TL_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: Array.from(new Set(scopes)).join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    providers: 'uk-ob-all'
  };

  if (institution.id) params.provider_id = institution.id;
  if (process.env.TL_USE_SANDBOX === 'true') params.enable_mock = 'true';

  const authUrl = buildAuthUrl(params);
  const expiresAt = new Date(Date.now() + (1000 * 60 * 15));

  const sessions = pruneSessions(Array.isArray(user.integrationSessions) ? user.integrationSessions : []);
  sessions.push({
    provider: 'truelayer',
    state: stateToken,
    codeVerifier,
    institution,
    scopes: Array.from(new Set(scopes)),
    createdAt: new Date(),
    metadata: {
      sandbox: process.env.TL_USE_SANDBOX === 'true',
      expiresAt,
      returnTo: req.body?.returnTo || null
    }
  });
  user.integrationSessions = sessions;

  const list = Array.isArray(user.integrations) ? [...user.integrations] : [];
  ensureBaseIntegration(list, 'truelayer', 'TrueLayer Open Banking');
  const idx = list.findIndex((i) => normaliseKey(i.key) === 'truelayer');
  if (idx >= 0) {
    list[idx] = {
      ...list[idx],
      status: 'pending',
      lastCheckedAt: new Date(),
      metadata: {
        ...(list[idx].metadata || {}),
        lastLaunchAt: new Date(),
        sandbox: process.env.TL_USE_SANDBOX === 'true'
      }
    };
  }
  user.integrations = list;

  await user.save();

  res.json({ authUrl, expiresAt });
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

  res.json({
    integration: redactIntegration(payload),
    integrations: list.map(redactIntegration),
    catalog: cataloguePayload()
  });
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

  res.json({
    integration: redactIntegration(list[idx]),
    integrations: list.map(redactIntegration),
    catalog: cataloguePayload()
  });
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
  res.json({
    integration: redactIntegration(list[targetIdx]),
    integrations: list.map(redactIntegration)
  });
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
  res.json({
    ok: true,
    integrations: filtered.map(redactIntegration),
    catalog: cataloguePayload()
  });
});

module.exports = router;
