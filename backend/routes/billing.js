// backend/routes/billing.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const PaymentMethod = require('../models/PaymentMethod');
const Subscription = require('../models/Subscription');
const User = require('../models/User');

// In-memory plan catalog (could move to DB/config later)
const PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    currency: 'USD',
    badge: '1-month Basic trial included',
    features: [
      'Get started with core dashboard',
      'Upload key documents (limited)',
      'Basic insights & reminders',
      'Email support (48h)',
      '1-month Basic features trial'
    ]
  },
  {
    id: 'basic',
    name: 'Basic',
    price: 6.99,
    currency: 'USD',
    badge: 'Best for everyday finances',
    features: [
      'Open Banking connection (bank feeds)',
      'Upload statements from investments',
      'Spending analytics & biggest expenses',
      'Income, tax paid, savings & net-worth tracking',
      'Document Vault (standard)',
      'Priority support (24h)'
    ]
  },
  {
    id: 'premium',
    name: 'Premium',
    price: 9.99,
    currency: 'USD',
    badge: 'Full accounting toolkit',
    features: [
      'Everything in Basic',
      'Self Assessment preparation helper',
      'Equity/CGT engine & disposal planner',
      'Gifts & IHT log with timelines',
      'Smart tasks & deadline nudges',
      'Document Vault (advanced, OCR & stale flags)',
      'Priority support (same day)'
    ]
  }
];

// Helpers
function brandFromNumber(num) {
  const s = String(num || '');
  if (/^4\d{6,}$/.test(s)) return 'Visa';
  if (/^5[1-5]\d{5,}$/.test(s)) return 'Mastercard';
  if (/^3[47]\d{5,}$/.test(s)) return 'Amex';
  if (/^6(?:011|5)\d{4,}$/.test(s)) return 'Discover';
  return 'Card';
}

// GET /api/billing/plans
router.get('/plans', auth, async (req, res) => {
  const user = await User.findById(req.user.id).lean();
  const current = (user?.licenseTier || 'free').toLowerCase();
  res.json({ current, plans: PLANS });
});

// GET /api/billing/payment-methods
router.get('/payment-methods', auth, async (req, res) => {
  const items = await PaymentMethod.find({ userId: req.user.id }).sort({ isDefault: -1, createdAt: -1 }).lean();
  res.json({ methods: items });
});

// POST /api/billing/payment-methods
router.post('/payment-methods', auth, async (req, res) => {
  // ⚠️ Demo mode: accept any details. DO NOT store PAN/CVC in production.
  const { holder, cardNumber, expMonth, expYear, cvc } = req.body || {};
  if (!holder || !cardNumber || !expMonth || !expYear) {
    return res.status(400).json({ error: 'holder, cardNumber, expMonth, expYear are required' });
  }
  const last4 = String(cardNumber).slice(-4);
  const brand = brandFromNumber(cardNumber);

  const existing = await PaymentMethod.find({ userId: req.user.id }).countDocuments();
  const pm = await PaymentMethod.create({
    userId: req.user.id,
    holder,
    brand,
    last4,
    expMonth: Number(expMonth),
    expYear: Number(expYear),
    isDefault: existing === 0
  });

  res.status(201).json({ method: pm });
});

// PATCH /api/billing/payment-methods/:id/default
router.patch('/payment-methods/:id/default', auth, async (req, res) => {
  const id = req.params.id;
  const method = await PaymentMethod.findOne({ _id: id, userId: req.user.id });
  if (!method) return res.status(404).json({ error: 'Payment method not found' });

  await PaymentMethod.updateMany({ userId: req.user.id }, { $set: { isDefault: false } });
  method.isDefault = true;
  await method.save();
  res.json({ ok: true });
});

// DELETE /api/billing/payment-methods/:id
router.delete('/payment-methods/:id', auth, async (req, res) => {
  const id = req.params.id;
  const user = await User.findById(req.user.id).lean();
  const methods = await PaymentMethod.find({ userId: req.user.id }).sort({ createdAt: 1 });
  const target = methods.find(m => String(m._id) === String(id));
  if (!target) return res.status(404).json({ error: 'Payment method not found' });

  // Enforce: cannot delete the last PM if user is on paid plan
  const onPaidPlan = (user?.licenseTier || 'free') !== 'free';
  if (onPaidPlan && methods.length === 1) {
    return res.status(400).json({
      error: 'Cannot delete your last payment method while on a paid plan. Please add another method or downgrade to Free.'
    });
  }

  await PaymentMethod.deleteOne({ _id: target._id, userId: req.user.id });

  // Ensure someone remains default
  if (target.isDefault) {
    const remaining = await PaymentMethod.findOne({ userId: req.user.id }).sort({ createdAt: 1 });
    if (remaining) { remaining.isDefault = true; await remaining.save(); }
  }

  res.json({ ok: true });
});

// GET /api/billing/subscription
router.get('/subscription', auth, async (req, res) => {
  const sub = await Subscription.findOne({ userId: req.user.id, status: 'active' }).sort({ createdAt: -1 });
  const user = await User.findById(req.user.id);
  res.json({
    licenseTier: user?.licenseTier || 'free',
    subscription: sub || null
  });
});

// POST /api/billing/subscribe
router.post('/subscribe', auth, async (req, res) => {
  const { plan, paymentMethodId } = req.body || {};
  if (!['free','basic','premium'].includes(String(plan))) {
    return res.status(400).json({ error: 'Invalid plan' });
  }

  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const planDef = PLANS.find(p => p.id === plan);
  if (!planDef) return res.status(400).json({ error: 'Plan not found' });

  // For paid plans, ensure a payment method exists
  if (plan !== 'free') {
    let pm = null;
    if (paymentMethodId) {
      pm = await PaymentMethod.findOne({ _id: paymentMethodId, userId: req.user.id });
      if (!pm) return res.status(400).json({ error: 'Selected payment method not found' });
    } else {
      pm = await PaymentMethod.findOne({ userId: req.user.id, isDefault: true });
      if (!pm) return res.status(400).json({ error: 'Add a payment method before subscribing' });
    }
    // ⚠️ Demo: No actual charge. In production, call PSP (Stripe) to create subscription.
  }

  // Cancel any active subscription and create a new one if not free
  const active = await Subscription.findOne({ userId: req.user.id, status: 'active' });
  if (active) { active.status = 'canceled'; await active.save(); }

  if (plan === 'free') {
    user.licenseTier = 'free';
    await user.save();
    return res.json({ ok: true, licenseTier: user.licenseTier, subscription: null });
  }

  const sub = await Subscription.create({
    userId: req.user.id,
    plan,
    price: planDef.price,
    currency: planDef.currency,
    status: 'active',
    startedAt: new Date()
  });
  user.licenseTier = plan;
  await user.save();

  res.json({ ok: true, licenseTier: user.licenseTier, subscription: sub });
});

// POST /api/billing/cancel  (downgrade to free)
router.post('/cancel', auth, async (req, res) => {
  const active = await Subscription.findOne({ userId: req.user.id, status: 'active' });
  if (active) { active.status = 'canceled'; await active.save(); }
  await User.findByIdAndUpdate(req.user.id, { $set: { licenseTier: 'free' } });
  res.json({ ok: true, licenseTier: 'free' });
});

module.exports = router;
