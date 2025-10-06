// backend/routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const User = require('../models/User');
const PaymentMethod = require('../models/PaymentMethod');
const Subscription = require('../models/Subscription');

const { sendEmailVerification } = require('../services/mailer');

const router = express.Router();

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

function createVerificationToken() {
  return crypto.randomBytes(32).toString('hex');
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
    const {
      firstName, lastName, username, email,
      password, passwordConfirm,
      dateOfBirth,
      agreeLegal,         // boolean
      legalVersion,       // optional override from client; we still set server-side
      planTier,
      couponCode,
      paymentMethod,
      billingAddress,
      selectedGoals,
      country,
    } = req.body || {};

    // Required checks
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

    // DOB validation
    const dob = new Date(String(dateOfBirth));
    if (isNaN(dob.getTime())) return res.status(400).json({ error: 'Invalid date of birth' });
    if (dob >= new Date()) return res.status(400).json({ error: 'Date of birth must be in the past' });

    // Legal acceptance (REQUIRED)
    if (!agreeLegal) {
      return res.status(400).json({ error: 'You must agree to the Terms to create an account' });
    }

    const emailN = normEmail(email);
    const userN  = normUsername(username);

    // Availability
    const [emailExists, usernameExists] = await Promise.all([
      User.exists({ email: emailN }),
      userN ? User.exists({ username: userN }) : Promise.resolve(null),
    ]);
    if (emailExists) return res.status(409).json({ error: 'Email already registered' });
    if (usernameExists) return res.status(409).json({ error: 'Username already in use' });

    // Create
    const hash = await bcrypt.hash(String(password), 10);
    const plan = determinePlan(planTier, couponCode);

    const user = new User({
      firstName: String(firstName).trim(),
      lastName:  String(lastName).trim(),
      username:  userN || '',
      email:     emailN,
      password:  hash,
      dateOfBirth: dob,
      eulaAcceptedAt: new Date(),
      eulaVersion: String(legalVersion || LEGAL_VERSION),
      licenseTier: plan.tier === 'premium' ? 'premium' : plan.tier,
      roles: ['user'],
      country: country === 'us' ? 'us' : 'uk',
      subscription: {
        tier: plan.tier,
        status: plan.status || 'trial',
        lastPlanChange: new Date(),
        renewsAt: plan.renewsAt || plan.trial?.endsAt || null
      },
      trial: plan.trial || null,
      onboarding: {
        goals: Array.isArray(selectedGoals) ? selectedGoals.filter(Boolean) : [],
        wizardCompletedAt: null,
        tourCompletedAt: null,
        lastPromptedAt: new Date()
      },
      integrations: seedIntegrations(),
      usageStats: {
        documentsUploaded: 0,
        documentsRequiredMet: 0,
        documentsRequiredCompleted: 0,
        documentsRequiredTotal: 0,
        documentsOutstanding: 0,
        moneySavedEstimate: 0,
        moneySavedPrevSpend: 0,
        moneySavedChangePct: null,
        debtOutstanding: 0,
        debtReduced: 0,
        debtReductionDelta: 0,
        netCashFlow: 0,
        netCashPrev: 0,
        usageWindowDays: 0,
        hmrcFilingsComplete: 0,
        minutesActive: 0,
        updatedAt: null
      },
      // uid auto-generates via schema default
    });
    const verificationToken = createVerificationToken();
    user.emailVerification = {
      token: verificationToken,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
      sentAt: new Date()
    };
    await user.save();

    // Attach payment method (demo storage, PAN/CVV never persisted)
    if (paymentMethod && paymentMethod.last4) {
      const pm = new PaymentMethod({
        userId: user._id,
        brand: paymentMethod.brand || 'Card',
        last4: String(paymentMethod.last4).slice(-4),
        expMonth: paymentMethod.expMonth || null,
        expYear: paymentMethod.expYear || null,
        holder: paymentMethod.holder || `${user.firstName} ${user.lastName}`,
        isDefault: true
      });
      await pm.save();
    }

    await Subscription.create({
      userId: user._id,
      plan: plan.tier,
      interval: 'monthly',
      price: 0,
      currency: 'GBP',
      status: plan.status === 'active' ? 'active' : 'active',
      currentPeriodEnd: plan.renewsAt || plan.trial?.endsAt || null
    });

    try {
      await sendEmailVerification({
        to: user.email,
        name: `${user.firstName} ${user.lastName}`.trim(),
        token: verificationToken
      });
    } catch (emailErr) {
      console.warn('Signup email dispatch failed:', emailErr);
    }

    res.status(201).json({
      requiresEmailVerification: true,
      user: publicUser(user)
    });
  } catch (e) {
    console.error('Signup error:', e);
    if (e?.code === 11000) {
      if (e.keyPattern?.email)    return res.status(409).json({ error: 'Email already registered' });
      if (e.keyPattern?.username) return res.status(409).json({ error: 'Username already in use' });
      if (e.keyPattern?.uid)      return res.status(500).json({ error: 'Failed to allocate user id; please retry' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Missing credentials' });

    const user = await User.findOne({ email: normEmail(email) });
    if (!user || !user.password) return res.status(400).json({ error: 'Invalid credentials' });

    // Backfill uid if missing
    if (!user.uid) { user.uid = undefined; await user.save(); }

    const ok = await bcrypt.compare(String(password), user.password);
    if (!ok) return res.status(400).json({ error: 'Invalid credentials' });

    if (!user.emailVerified) {
      return res.status(403).json({ error: 'Please verify your email to continue.', needsVerification: true });
    }

    const token = issueToken(user._id);
    res.json({ token, user: publicUser(user) });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

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
