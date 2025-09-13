// backend/routes/billing.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const PaymentMethod = require('../models/PaymentMethod');
const Subscription = require('../models/Subscription');
const User = require('../models/User');

// ---------- Plan catalogue (GBP) ----------
const GBP = 'GBP';
const MONTHLY = {
  free:         0.00,
  basic:        3.99,
  professional: 6.99
};

function round2(n){ return Math.round(n * 100) / 100; }

// Yearly prices: Basic 10% cheaper than 12 months, Professional 15% cheaper
const YEARLY = {
  free:         0.00,
  basic:        round2(MONTHLY.basic * 12 * 0.90),
  professional: round2(MONTHLY.professional * 12 * 0.85),
};

// Keep a single source of truth you can export in responses
const TABLE = { monthly: MONTHLY, yearly: YEARLY };

const FEATURES = {
  free: [
    '1-month full-feature trial',
    'After trial: document vault (up to 10 files)',
    'Manual uploads & basic reminders',
    'One portfolio, basic dashboards',
    'Email support (48h)'
  ],
  basic: [
    'TrueLayer bank integration',
    'Automated transaction sync & categorisation',
    'Financial analytics & Biggest Costs',
    'Deadline nudges & document reminders',
    'CSV import for brokers/accounts',
    'Document vault (standard)',
    'Priority support (24h)'
  ],
  professional: [
    'Everything in Basic',
    'All product features & advanced dashboards',
    'Self Assessment prep helper',
    'Equity/CGT engine & disposal planner',
    'Gifts & IHT log with timelines',
    'Scenario Lab & multi-portfolio',
    'Document Vault (advanced OCR & stale flags)',
    'Priority support (same day)'
  ]
};

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    priceMonthly: MONTHLY.free,
    priceYearly: YEARLY.free,
    currency: GBP,
    badge: '1-month full trial',
    features: FEATURES.free
  },
  {
    id: 'basic',
    name: 'Basic',
    priceMonthly: MONTHLY.basic,
    priceYearly: YEARLY.basic,
    currency: GBP,
    badge: 'Great for everyday finance',
    features: FEATURES.basic
  },
  {
    id: 'professional',
    name: 'Professional',
    priceMonthly: MONTHLY.professional,
    priceYearly: YEARLY.professional,
    currency: GBP,
    badge: 'All features',
    features: FEATURES.professional
  }
];

// ---------- Helpers ----------
function normalizeInterval(v) {
  const s = String(v || '').toLowerCase().trim();
  if (['y', 'yr', 'year', 'yearly', 'annual', 'annually'].includes(s)) return 'yearly';
  if (['m', 'mo', 'mon', 'month', 'monthly'].includes(s)) return 'monthly';
  return 'monthly';
}

// Accept either 'premium' or 'professional' from the UI; internally we store 'professional'
function inPlanSet(id) {
  return ['free','basic','professional','premium'].includes(String(id || '').toLowerCase());
}
function toInternalPlanId(id) {
  const v = String(id || '').toLowerCase().trim();
  if (v === 'premium') return 'professional';
  return v;
}

// Convenience: expose a prices object matching a given interval
function pricesFor(interval) {
  const i = normalizeInterval(interval);
  return TABLE[i];
}

// ---------- Plans (returns current plan + cycle) ----------
router.get('/plans', auth, async (req, res) => {
  const user = await User.findById(req.user.id).lean();
  const current = (user?.licenseTier || 'free').toLowerCase();

  // Read most recent active subscription to determine cycle
  let currentCycle = 'monthly';
  const sub = await Subscription.findOne({ userId: req.user.id, status: 'active' })
    .sort({ createdAt: -1 })
    .lean();
  if (sub) currentCycle = String(sub.interval || sub.billingInterval || 'monthly').toLowerCase();

  // Optional: UI may request a preferred interval; we still return the same shape
  const interval = normalizeInterval(req.query.interval);

  res.json({
    current,
    currentCycle,
    interval,           // harmless extra (doesn't break old clients)
    prices: pricesFor(interval), // harmless extra (doesn't break old clients)
    plans: PLANS
  });
});

// ---------- Payment methods ----------
router.get('/payment-methods', auth, async (req, res) => {
  const items = await PaymentMethod.find({ userId: req.user.id })
    .sort({ isDefault: -1, createdAt: -1 })
    .lean();
  res.json({ methods: items });
});

router.post('/payment-methods', auth, async (req, res) => {
  // Demo only – do not store real PAN/CVC in production.
  const { holder, cardNumber, expMonth, expYear } = req.body || {};
  if (!holder || !cardNumber || !expMonth || !expYear) {
    return res.status(400).json({ error: 'holder, cardNumber, expMonth, expYear are required' });
  }
  const last4 = String(cardNumber).slice(-4);
  const brand = brandFromNumber(cardNumber);

  const existing = await PaymentMethod.countDocuments({ userId: req.user.id });
  const pm = await PaymentMethod.create({
    userId: req.user.id,
    holder, brand, last4,
    expMonth: Number(expMonth),
    expYear: Number(expYear),
    isDefault: existing === 0
  });
  res.status(201).json({ method: pm });
});

router.patch('/payment-methods/:id/default', auth, async (req, res) => {
  const id = req.params.id;
  const method = await PaymentMethod.findOne({ _id: id, userId: req.user.id });
  if (!method) return res.status(404).json({ error: 'Payment method not found' });

  await PaymentMethod.updateMany({ userId: req.user.id }, { $set: { isDefault: false } });
  method.isDefault = true;
  await method.save();
  res.json({ ok: true });
});

router.delete('/payment-methods/:id', auth, async (req, res) => {
  const id = req.params.id;
  const user = await User.findById(req.user.id).lean();
  const methods = await PaymentMethod.find({ userId: req.user.id }).sort({ createdAt: 1 });
  const target = methods.find(m => String(m._id) === String(id));
  if (!target) return res.status(404).json({ error: 'Payment method not found' });

  const onPaidPlan = (user?.licenseTier || 'free') !== 'free';
  if (onPaidPlan && methods.length === 1) {
    return res.status(400).json({
      error: 'Deleting your last payment method will move you to the Free tier. Continue?'
    });
  }

  await PaymentMethod.deleteOne({ _id: target._id, userId: req.user.id });

  if (target.isDefault) {
    const remaining = await PaymentMethod.findOne({ userId: req.user.id }).sort({ createdAt: 1 });
    if (remaining) { remaining.isDefault = true; await remaining.save(); }
  }
  res.json({ ok: true });
});

function brandFromNumber(num) {
  const s = String(num || '');
  if (/^4\d{6,}$/.test(s)) return 'Visa';
  if (/^5[1-5]\d{5,}$/.test(s)) return 'Mastercard';
  if (/^3[47]\d{5,}$/.test(s)) return 'Amex';
  if (/^6(?:011|5)\d{4,}$/.test(s)) return 'Discover';
  return 'Card';
}

// ---------- Subscription ----------
router.get('/subscription', auth, async (req, res) => {
  const sub = await Subscription.findOne({ userId: req.user.id, status: 'active' }).sort({ createdAt: -1 });
  const user = await User.findById(req.user.id);
  res.json({
    licenseTier: user?.licenseTier || 'free',
    subscription: sub ? {
      id: sub._id,
      plan: sub.plan,
      price: sub.price,
      currency: sub.currency,
      status: sub.status,
      interval: sub.interval || sub.billingInterval || 'monthly',
      startedAt: sub.startedAt
    } : null
  });
});

router.post('/subscribe', auth, async (req, res) => {
  const { plan, paymentMethodId, interval, billingCycle } = req.body || {};
  const planRaw  = String(plan || '').toLowerCase();
  if (!inPlanSet(planRaw)) {
    return res.status(400).json({ error: 'Invalid plan' });
  }
  const planId = toInternalPlanId(planRaw); // map premium -> professional

  const chosen = normalizeInterval(interval || billingCycle); // accept 'year','annual','yr' etc.

  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const def = PLANS.find(p => p.id === planId);
  if (!def) return res.status(400).json({ error: 'Plan not found' });

  // Paid tiers must have a payment method
  if (planId !== 'free') {
    let pm = null;
    if (paymentMethodId) {
      pm = await PaymentMethod.findOne({ _id: paymentMethodId, userId: req.user.id });
      if (!pm) return res.status(400).json({ error: 'Selected payment method not found' });
    } else {
      pm = await PaymentMethod.findOne({ userId: req.user.id, isDefault: true });
      if (!pm) return res.status(400).json({ error: 'Add a payment method before subscribing' });
    }
  }

  // Cancel previous active sub
  const active = await Subscription.findOne({ userId: req.user.id, status: 'active' });
  if (active) { active.status = 'canceled'; await active.save(); }

  if (planId === 'free') {
    user.licenseTier = 'free';
    await user.save();
    return res.json({ ok: true, licenseTier: 'free', subscription: null });
  }

  const price = chosen === 'yearly' ? def.priceYearly : def.priceMonthly;

  const sub = await Subscription.create({
    userId: req.user.id,
    plan: planId,
    price,
    currency: def.currency,
    status: 'active',
    interval: chosen,         // store the chosen interval
    startedAt: new Date()
  });

  user.licenseTier = planId;
  await user.save();

  res.json({
    ok: true,
    licenseTier: user.licenseTier,
    subscription: {
      id: sub._id, plan: sub.plan, price: sub.price, currency: sub.currency,
      status: sub.status, interval: sub.interval, startedAt: sub.startedAt
    }
  });
});

router.post('/cancel', auth, async (req, res) => {
  const active = await Subscription.findOne({ userId: req.user.id, status: 'active' });
  if (active) { active.status = 'canceled'; await active.save(); }
  await User.findByIdAndUpdate(req.user.id, { $set: { licenseTier: 'free' } });
  res.json({ ok: true, licenseTier: 'free' });
});

// ---------- Read-only helpers (don’t break existing clients) ----------
// GET /api/billing/prices?interval=monthly|yearly|year|annual|...
router.get('/prices', auth, (req, res) => {
  const interval = normalizeInterval(req.query.interval);
  res.json({ interval, prices: pricesFor(interval) });
});

// GET /api/billing/price?plan=premium|professional|basic|free&interval=...
router.get('/price', auth, (req, res) => {
  const interval = normalizeInterval(req.query.interval);
  const planId = toInternalPlanId(req.query.plan);
  const table = pricesFor(interval);
  const amount = table?.[planId];
  if (typeof amount !== 'number') {
    return res.status(400).json({ error: `Unknown plan '${req.query.plan}' or interval '${req.query.interval || 'monthly'}'` });
  }
  res.json({ plan: req.query.plan, planInternal: planId, interval, amount });
});

module.exports = router;
