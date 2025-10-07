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
const WORKOS_DEFAULT_PROVIDER = (process.env.WORKOS_DEFAULT_PROVIDER || 'authkit').toLowerCase();
const WORKOS_DEFAULT_CONNECTION_ID = process.env.WORKOS_DEFAULT_CONNECTION_ID || '';
const WORKOS_DEFAULT_ORGANIZATION_ID = process.env.WORKOS_DEFAULT_ORGANIZATION_ID || '';

const workos = (WorkOS && WORKOS_API_KEY) ? new WorkOS(WORKOS_API_KEY) : null;

if (workos && WORKOS_CLIENT_ID) {
  console.log("✅ WorkOS AuthKit provider correctly configured (provider='authkit')");
}

const OAUTH_PROVIDER_MAP = {
  authkit: 'authkit',
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
  organizationId,
} = {}) {
  ensureWorkOSConfigured();

  const chosenProviderKey = providerKey || WORKOS_DEFAULT_PROVIDER;
  let provider = resolveProvider(chosenProviderKey);
  if (!provider && chosenProviderKey) {
    provider = chosenProviderKey;
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

  const connection = String(connectionId || WORKOS_DEFAULT_CONNECTION_ID || '').trim();
  if (connection) params.connectionId = connection;

  const organization = String(organizationId || WORKOS_DEFAULT_ORGANIZATION_ID || '').trim();
  if (organization) params.organizationId = organization;

  if (!params.provider && !params.connectionId && !params.organizationId) {
    // WorkOS AuthKit expects provider to be 'authkit' (lowercase).
    // 'AuthKit' (capitalized) will throw “provider not valid”.
    params.provider = 'authkit';
  }

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
function isValidEmail(x) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(x || ''));
}

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

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    ensureWorkOSConfigured();

    const {
      firstName,
      lastName,
      email,
      password,
      passwordConfirm,
      dateOfBirth,
      agreeLegal,
      legalVersion,
    } = req.body || {};

    if (!firstName || !lastName || !email || !password || !passwordConfirm || !dateOfBirth) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email address' });
    if (String(password) !== String(passwordConfirm)) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const dob = new Date(String(dateOfBirth));
    if (Number.isNaN(dob.getTime())) {
      return res.status(400).json({ error: 'Invalid date of birth' });
    }
    if (dob >= new Date()) {
      return res.status(400).json({ error: 'Date of birth must be in the past' });
    }

    if (!agreeLegal) {
      return res.status(400).json({ error: 'You must agree to the Terms to create an account' });
    }

    const emailN = normEmail(email);
    const nameFirst = String(firstName).trim();
    const nameLast = String(lastName).trim();

    let workosUser;
    try {
      workosUser = await workos.userManagement.createUser({
        email: emailN,
        password: String(password),
        firstName: nameFirst,
        lastName: nameLast,
      });
    } catch (err) {
      const status = err?.status || err?.statusCode || err?.response?.status;
      const code = err?.code || err?.response?.data?.code;
      if (status === 409 || code === 'user_already_exists') {
        return res.status(409).json({ error: 'Email already registered' });
      }
      console.error('WorkOS createUser error:', err);
      return res.status(502).json({ error: 'Failed to create account with identity provider' });
    }

    const localUser = await ensureLocalUserFromWorkOS(workosUser?.user || workosUser, {
      fallbackEmail: emailN,
      firstName: nameFirst,
      lastName: nameLast,
      dateOfBirth: dob,
      passwordPlain: password,
      agreeLegal: true,
    });

    if (!localUser) {
      return res.status(500).json({ error: 'Account provisioning failed' });
    }

    localUser.eulaAcceptedAt = new Date();
    localUser.eulaVersion = String(legalVersion || LEGAL_VERSION);
    await localUser.save();

    try {
      const authResult = await workos.userManagement.authenticateWithPassword({
        clientId: WORKOS_CLIENT_ID,
        email: emailN,
        password: String(password),
        ipAddress: req.ip,
        userAgent: req.get('user-agent') || undefined,
      });
      if (authResult?.user) {
        await ensureLocalUserFromWorkOS(authResult.user, {
          fallbackEmail: emailN,
          firstName: nameFirst,
          lastName: nameLast,
          dateOfBirth: dob,
          agreeLegal: true,
        });
      }
    } catch (authErr) {
      console.warn('WorkOS auto-login after signup failed:', authErr);
    }

    const token = issueToken(localUser._id);
    res.status(201).json({ token, user: publicUser(localUser) });
  } catch (e) {
    console.error('Signup error:', e);
    res.status(e?.statusCode || e?.status || 500).json({ error: e?.message || 'Server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    ensureWorkOSConfigured();

    const { identifier, email, username, password } = req.body || {};
    const rawEmail = email || identifier || null;
    const rawUsername = username || (!rawEmail && identifier ? identifier : null);

    if ((!rawEmail && !rawUsername) || !password) {
      return res.status(400).json({ error: 'Missing credentials' });
    }

    let emailN = rawEmail ? normEmail(rawEmail) : null;
    if (!emailN && rawUsername) {
      const existing = await User.findOne({ username: normUsername(rawUsername) });
      if (existing) emailN = normEmail(existing.email);
    }

    if (!emailN) return res.status(400).json({ error: 'Email is required' });

    const result = await workos.userManagement.authenticateWithPassword({
      clientId: WORKOS_CLIENT_ID,
      email: emailN,
      password: String(password),
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || undefined,
    });

    const localUser = await ensureLocalUserFromWorkOS(result?.user, { fallbackEmail: emailN });
    if (!localUser) return res.status(500).json({ error: 'Account sync failed' });

    const token = issueToken(localUser._id);
    res.json({ token, user: publicUser(localUser) });
  } catch (err) {
    const status = err?.statusCode || err?.status || 500;
    if (status === 400 || status === 401) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    console.error('WorkOS login error:', err);
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
      organizationId: req.query.organizationId || req.query.organization,
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
      organizationId: req.query.organizationId || req.query.organization,
    });
    res.redirect(url);
  } catch (err) {
    console.error('WorkOS start redirect error:', err);
    const message = encodeURIComponent(err?.message || 'Unable to start sign-in. Please try again.');
    res.redirect(`/login.html?error=${message}`);
  }
}

router.get('/workos/start', (req, res) => { startHostedAuthRedirect(req, res); });
router.get('/workos/login', (req, res) => { startHostedAuthRedirect(req, res); });

async function handleWorkOSCallback(req, res) {
  try {
    ensureWorkOSConfigured();

    const { error, error_description: errorDescription, code, state } = req.query || {};
    if (error || !code) {
      const message = encodeURIComponent(errorDescription || error || 'Authentication was cancelled.');
      return res.redirect(`/login.html?error=${message}`);
    }

    const authResult = await workos.userManagement.authenticateWithAuthorizationCode({
      clientId: WORKOS_CLIENT_ID,
      code: String(code),
    });

    const stateData = decodeState(state);
    const next = sanitizeNext(stateData.next || '/home.html');
    const remember = !!stateData.remember;
    const intent = parseIntent(stateData.intent);

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

    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Redirecting…</title></head><body><script>(function(){try{var store=window.${storage};if(store){store.setItem('token',${tokenJson});store.setItem('me',JSON.stringify(${userJson}));}}catch(e){console.error('AuthKit sync failed',e);}window.location.replace(${JSON.stringify(next)});}());</script></body></html>`;

    res.type('html').send(html);
  } catch (err) {
    console.error('WorkOS callback error:', err);
    const message = encodeURIComponent('Sign-in failed. Please try again.');
    res.redirect(`/login.html?error=${message}`);
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
