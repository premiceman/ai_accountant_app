// backend/routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
let WorkOS;
try {
  ({ WorkOS } = require('@workos-inc/node'));
} catch (err) {
  WorkOS = null;
  console.warn('⚠️  WorkOS SDK not available. AuthKit flows will be disabled.');
}

const User = require('../models/User');
const Subscription = require('../models/Subscription');

const router = express.Router();

const WORKOS_API_KEY = process.env.WORKOS_API_KEY || process.env.WORKOS_KEY || '';
const WORKOS_CLIENT_ID = process.env.WORKOS_CLIENT_ID || process.env.WORKOS_CLIENT || '';
const WORKOS_REDIRECT_URI = process.env.WORKOS_REDIRECT_URI || 'https://www.phloat.io/callback';

const workos = (WorkOS && WORKOS_API_KEY) ? new WorkOS(WORKOS_API_KEY) : null;

const OAUTH_PROVIDER_MAP = {
  google: 'GoogleOAuth',
  apple: 'AppleOAuth',
  microsoft: 'MicrosoftOAuth'
};

function resolveProvider(providerKey) {
  const key = String(providerKey || '').toLowerCase();
  if (!key) return null;
  return OAUTH_PROVIDER_MAP[key] || null;
}

function parseIntent(raw) {
  const value = String(raw || '').toLowerCase();
  return value === 'signup' ? 'signup' : 'login';
}

function parseBooleanParam(value) {
  const normalized = String(value || '').toLowerCase();
  return ['true', '1', 'yes', 'on'].includes(normalized);
}

function ensureWorkOSConfigured() {
  if (!workos || !WORKOS_CLIENT_ID) {
    const msg = 'WorkOS AuthKit is not configured';
    const err = new Error(msg);
    err.statusCode = 500;
    throw err;
  }
}

function encodeState(payload = {}) {
  try {
    return Buffer.from(JSON.stringify(payload)).toString('base64url');
  } catch {
    return '';
  }
}

function decodeState(state) {
  if (!state) return {};
  try {
    const json = Buffer.from(String(state), 'base64url').toString('utf8');
    const parsed = JSON.parse(json);
    return typeof parsed === 'object' && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function sanitizeNext(next) {
  if (typeof next !== 'string' || !next) return '/home.html';
  const trimmed = next.trim();
  if (!trimmed) return '/home.html';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('//')) {
    return '/home.html';
  }
  if (!trimmed.startsWith('/')) {
    return '/' + trimmed.replace(/^\.+/, '');
  }
  return trimmed;
}

const TOKEN_TTL  = process.env.JWT_EXPIRES_IN || '2h';
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const LEGAL_VERSION = process.env.LEGAL_VERSION || '2025-09-15';
const TRIAL_DAYS    = Number(process.env.SIGNUP_TRIAL_DAYS || 30);
const COUPON_LIFETIME_TIER = 'phloatadmin1998';

const INTEGRATION_SEEDS = [
  { key: 'hmrc',       label: 'HMRC Portal' },
  { key: 'truelayer',  label: 'TrueLayer' },
  { key: 'companies',  label: 'Companies House' },
  { key: 'quickbooks', label: 'QuickBooks' },
  { key: 'xero',       label: 'Xero' }
];

const issueToken = (userId) => jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: TOKEN_TTL });

async function buildAuthorizationUrl({
  providerKey,
  next,
  remember,
  intent,
  email,
  connectionId,
} = {}) {
  ensureWorkOSConfigured();

  const provider = resolveProvider(providerKey);
  if (providerKey && !provider) {
    const err = new Error('Unsupported provider');
    err.statusCode = 400;
    throw err;
  }

  const state = encodeState({
    next: sanitizeNext(next || '/home.html'),
    remember: parseBooleanParam(remember),
    intent: parseIntent(intent),
  });

  const params = {
    clientId: WORKOS_CLIENT_ID,
    redirectUri: WORKOS_REDIRECT_URI,
    state,
  };

  if (provider) params.provider = provider;

  const loginHint = normEmail(email);
  if (loginHint) params.loginHint = loginHint;

  const connection = String(connectionId || '').trim();
  if (connection) params.connectionId = connection;

  return workos.userManagement.getAuthorizationUrl(params);
}

async function ensureLocalUserFromWorkOS(workosUser, {
  fallbackEmail,
  firstName,
  lastName,
  dateOfBirth,
  passwordPlain,
  agreeLegal = false,
} = {}) {
  if (!workosUser && !fallbackEmail) return null;

  const email = normEmail(workosUser?.email || fallbackEmail);
  if (!email) return null;

  const resolvedFirst = (workosUser?.firstName || firstName || '').trim() || 'Member';
  const resolvedLast = (workosUser?.lastName || lastName || '').trim() || 'Phloat';

  const workosId = workosUser?.id ? String(workosUser.id).trim() : null;

  const dob = dateOfBirth instanceof Date ? dateOfBirth : (dateOfBirth ? new Date(dateOfBirth) : null);

  let user = await User.findOne({ email });
  const now = new Date();
  let created = false;

  if (!user) {
    const plan = determinePlan('starter', null);
    const randomSecret = passwordPlain || crypto.randomBytes(24).toString('hex');
    const hash = await bcrypt.hash(String(randomSecret), 10);

    user = new User({
      firstName: resolvedFirst,
      lastName: resolvedLast,
      email,
      username: '',
      password: hash,
      dateOfBirth: dob || null,
      workosUserId: workosId || null,
      eulaAcceptedAt: agreeLegal ? now : null,
      eulaVersion: LEGAL_VERSION,
      licenseTier: plan.tier === 'premium' ? 'premium' : plan.tier,
      roles: ['user'],
      country: 'uk',
      subscription: {
        tier: plan.tier,
        status: plan.status || 'trial',
        lastPlanChange: now,
        renewsAt: plan.renewsAt || plan.trial?.endsAt || null,
      },
      trial: plan.trial || null,
      onboarding: { goals: [], wizardCompletedAt: null, tourCompletedAt: null, lastPromptedAt: null },
      integrations: seedIntegrations(),
    });
    created = true;
  } else {
    user.firstName = resolvedFirst || user.firstName;
    user.lastName = resolvedLast || user.lastName;
    if (workosId) user.workosUserId = workosId;
    if (dob && !Number.isNaN(dob.getTime())) user.dateOfBirth = dob;
    if (agreeLegal) {
      user.eulaAcceptedAt = now;
      user.eulaVersion = LEGAL_VERSION;
    }
  }

  if (typeof workosUser?.emailVerified === 'boolean') {
    user.emailVerified = workosUser.emailVerified;
  }

  await user.save();

  if (created) {
    try {
      await Subscription.create({
        userId: user._id,
        plan: user.subscription?.tier || 'starter',
        interval: 'monthly',
        price: 0,
        currency: 'GBP',
        status: user.subscription?.status || 'active',
        currentPeriodEnd: user.subscription?.renewsAt || user.trial?.endsAt || null,
      });
    } catch (subErr) {
      console.warn('Failed to seed subscription for WorkOS user:', subErr);
    }
  }

  return user;
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u._id,
    uid: u.uid,
    firstName: u.firstName || '',
    lastName: u.lastName || '',
    username: u.username || '',
    email: u.email || '',
    workosUserId: u.workosUserId || null,
    dateOfBirth: u.dateOfBirth || null,
    licenseTier: u.licenseTier || 'free',
    roles: Array.isArray(u.roles) ? u.roles : ['user'],
    country: u.country || 'uk',
    emailVerified: !!u.emailVerified,
    subscription: u.subscription || { tier: 'free', status: 'inactive' },
    trial: u.trial || null,
    preferences: u.preferences || {},
    onboarding: u.onboarding || {},
    usageStats: u.usageStats || {},
    eulaAcceptedAt: u.eulaAcceptedAt || null,
    eulaVersion: u.eulaVersion || null,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

function normEmail(x) { return String(x || '').trim().toLowerCase(); }
function normUsername(x) { return String(x || '').trim(); }
function determinePlan(tierRaw, couponRaw) {
  const tier = String(tierRaw || 'starter').toLowerCase();
  const coupon = String(couponRaw || '').trim().toLowerCase();

  if (coupon === COUPON_LIFETIME_TIER) {
    return {
      tier: 'premium',
      status: 'active',
      trial: { startedAt: new Date(), endsAt: null, coupon: couponRaw, requiresPaymentMethod: false }
    };
  }

  const supported = ['starter','growth','premium'];
  const resolvedTier = supported.includes(tier) ? tier : 'starter';
  const now = new Date();
  const ends = new Date(now.getTime() + TRIAL_DAYS * 86400 * 1000);

  return {
    tier: resolvedTier,
    status: 'trial',
    trial: { startedAt: now, endsAt: ends, coupon: couponRaw || null, requiresPaymentMethod: true },
    renewsAt: ends
  };
}

function seedIntegrations(existing = []) {
  const byKey = new Map((existing || []).map((i) => [i.key, i]));
  return INTEGRATION_SEEDS.map((seed) => ({
    ...seed,
    status: byKey.get(seed.key)?.status || 'not_connected',
    lastCheckedAt: byKey.get(seed.key)?.lastCheckedAt || null,
    metadata: byKey.get(seed.key)?.metadata || {}
  }));
}

function compactObject(obj) {
  const out = {};
  Object.entries(obj || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      out[key] = value;
    }
  });
  return out;
}

function sanitizeWorkOSUser(workosUser) {
  if (!workosUser) return null;
  const data = compactObject({
    id: workosUser.id,
    email: workosUser.email,
    firstName: workosUser.firstName,
    lastName: workosUser.lastName,
    emailVerified: typeof workosUser.emailVerified === 'boolean' ? workosUser.emailVerified : undefined,
    profilePictureUrl: workosUser.profilePictureUrl,
    createdAt: workosUser.createdAt,
    updatedAt: workosUser.updatedAt,
  });
  return Object.keys(data).length ? data : null;
}

function sanitizeWorkOSSession(session) {
  if (!session) return null;
  const data = compactObject({
    id: session.id,
    userId: session.userId || session.user?.id,
    organizationId: session.organizationId,
    expiresAt: session.expiresAt,
    authenticatedAt: session.authenticatedAt,
    createdAt: session.createdAt,
    type: session.type,
  });
  return Object.keys(data).length ? data : null;
}

function sanitizeWorkOSTokens(result) {
  if (!result) return null;
  const tokens = compactObject({
    accessToken: result.accessToken || result.authentication?.accessToken || result.session?.accessToken,
    refreshToken: result.refreshToken || result.authentication?.refreshToken || result.session?.refreshToken,
    tokenType: result.tokenType || result.authentication?.tokenType,
    expiresIn: result.expiresIn || result.authentication?.expiresIn,
  });
  return Object.keys(tokens).length ? tokens : null;
}

// GET /api/auth/check?email=&username=
router.get('/check', async (req, res) => {
  try {
    const email    = req.query.email ? normEmail(req.query.email) : null;
    const username = req.query.username ? normUsername(req.query.username) : null;

    const out = {};
    if (email) {
      const exists = await User.exists({ email });
      out.emailAvailable = !exists;
    }
    if (username) {
      const exists = await User.exists({ username });
      out.usernameAvailable = !exists;
    }
    if (!email && !username) return res.status(400).json({ error: 'email or username required' });
    res.json(out);
  } catch (e) {
    console.error('GET /auth/check error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/workos/authorize', async (req, res) => {
  try {
    const url = await buildAuthorizationUrl({
      providerKey: req.query.provider,
      next: req.query.next,
      remember: parseBooleanParam(req.query.remember),
      intent: req.query.intent,
      email: req.query.email,
      connectionId: req.query.connectionId || req.query.connection,
    });

    res.json({ authorizationUrl: url });
  } catch (err) {
    const status = err?.statusCode || err?.status || 500;
    if (status === 400) {
      return res.status(400).json({ error: err.message || 'Unsupported provider' });
    }
    console.error('WorkOS authorize error:', err);
    res.status(500).json({ error: 'Unable to start sign-in' });
  }
});

async function startHostedAuthRedirect(req, res) {
  try {
    const url = await buildAuthorizationUrl({
      providerKey: req.query.provider,
      next: req.query.next,
      remember: parseBooleanParam(req.query.remember),
      intent: req.query.intent,
      email: req.query.email,
      connectionId: req.query.connectionId || req.query.connection,
    });
    res.redirect(url);
  } catch (err) {
    console.error('WorkOS start redirect error:', err);
    const message = encodeURIComponent(err?.message || 'Unable to start sign-in. Please try again.');
    const fallbackIntent = parseIntent(req.query.intent);
    const fallbackPage = fallbackIntent === 'signup' ? '/signup.html' : '/login.html';
    res.redirect(`${fallbackPage}?error=${message}`);
  }
}

router.get('/workos/start', (req, res) => { startHostedAuthRedirect(req, res); });
router.get('/workos/login', (req, res) => { startHostedAuthRedirect(req, res); });

async function handleWorkOSCallback(req, res) {
  const { error, error_description: errorDescription, code, state } = req.query || {};
  const stateData = decodeState(state);
  const next = sanitizeNext(stateData.next || '/home.html');
  const remember = !!stateData.remember;
  const intent = parseIntent(stateData.intent);

  try {
    ensureWorkOSConfigured();

    if (error || !code) {
      const message = encodeURIComponent(errorDescription || error || 'Authentication was cancelled.');
      const fallback = intent === 'signup' ? '/signup.html' : '/login.html';
      return res.redirect(`${fallback}?error=${message}`);
    }

    const authResult = await workos.userManagement.authenticateWithAuthorizationCode({
      clientId: WORKOS_CLIENT_ID,
      code: String(code),
    });

    const localUser = await ensureLocalUserFromWorkOS(authResult?.user, {
      fallbackEmail: authResult?.user?.email,
      agreeLegal: intent === 'signup',
    });

    if (!localUser) throw new Error('Account sync failed');

    if (intent === 'signup' && !localUser.eulaAcceptedAt) {
      localUser.eulaAcceptedAt = new Date();
      localUser.eulaVersion = LEGAL_VERSION;
      await localUser.save();
    }

    const token = issueToken(localUser._id);
    const userPayload = publicUser(localUser);
    const storage = remember ? 'localStorage' : 'sessionStorage';
    const tokenJson = JSON.stringify(token);
    const userJson = JSON.stringify(userPayload).replace(/</g, '\\u003c');

    const workosState = compactObject({
      user: sanitizeWorkOSUser(authResult?.user),
      session: sanitizeWorkOSSession(authResult?.session),
      tokens: sanitizeWorkOSTokens(authResult),
    });
    const hasWorkOSState = Object.keys(workosState).length > 0;
    const workosJson = JSON.stringify(workosState).replace(/</g, '\\u003c');
    const workosSnippet = hasWorkOSState
      ? `store.setItem('workos', JSON.stringify(${workosJson}));`
      : `try{store.removeItem && store.removeItem('workos');}catch(e){}`;

    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Redirecting…</title></head><body><script>(function(){try{var store=window.${storage};if(store){store.setItem('token',${tokenJson});store.setItem('me',JSON.stringify(${userJson}));${workosSnippet}}}catch(e){console.error('AuthKit sync failed',e);}window.location.replace(${JSON.stringify(next)});}());</script></body></html>`;

    res.type('html').send(html);
  } catch (err) {
    console.error('WorkOS callback error:', err);
    const message = encodeURIComponent('Sign-in failed. Please try again.');
    const fallback = intent === 'signup' ? '/signup.html' : '/login.html';
    res.redirect(`${fallback}?error=${message}`);
  }
}

router.get('/workos/callback', (req, res) => { handleWorkOSCallback(req, res); });

// POST /api/auth/verify-email
router.post('/verify-email', async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'Token is required' });

    const user = await User.findOne({ 'emailVerification.token': token });
    if (!user) return res.status(400).json({ error: 'Invalid or expired token' });

    const { expiresAt } = user.emailVerification || {};
    if (expiresAt && expiresAt < new Date()) {
      return res.status(400).json({ error: 'Token has expired' });
    }

    user.emailVerified = true;
    user.emailVerification = { token: null, expiresAt: null, sentAt: null };
    await user.save();

    const jwtToken = issueToken(user._id);
    res.json({ token: jwtToken, user: publicUser(user) });
  } catch (e) {
    console.error('Verify email error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
module.exports.handleWorkOSCallback = handleWorkOSCallback;
