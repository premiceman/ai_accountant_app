// backend/src/routes/billing.routes.js
const express = require('express');
const jwt = require('jsonwebtoken');

const router = express.Router();

// Minimal auth helper for this router (reads Bearer token)
function getUserFromReq(req) {
  try {
    const hdr = req.headers.authorization || '';
    const m = hdr.match(/^Bearer\s+(.+)$/i);
    if (!m) return null;
    const token = m[1];
    const secret = process.env.JWT_SECRET || 'dev_secret_change_me';
    return jwt.verify(token, secret);
  } catch {
    return null;
  }
}

// GET /api/billing/plans  -> list plans to show on billing page
router.get('/plans', (req, res) => {
  // Stub plans; replace with Stripe/your pricing later
  const plans = [
    { id: 'free',     name: 'Free',     price: 0,     currency: 'GBP', interval: 'month',
      features: ['Document vault (R2)', 'Manual uploads', 'Basic analytics'] },
    { id: 'starter',  name: 'Starter',  price: 9,     currency: 'GBP', interval: 'month',
      features: ['Everything in Free', 'Automated validation', 'Bank feeds (sandbox)'] },
    { id: 'pro',      name: 'Pro',      price: 29,    currency: 'GBP', interval: 'month',
      features: ['Everything in Starter', 'Advanced analytics', 'Priority support'] },
    { id: 'business', name: 'Business', price: 79,    currency: 'GBP', interval: 'month',
      features: ['Multi-entity', 'Team access', 'Export & APIs'] }
  ];
  res.json({ plans });
});

// GET /api/billing/payment-methods -> list saved PMs for the user (stub = empty)
router.get('/payment-methods', (req, res) => {
  const user = getUserFromReq(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  // TODO: integrate Stripe and return real PMs for user.id
  res.json({ items: [] });
});

module.exports = router;
