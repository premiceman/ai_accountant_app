// backend/src/routes/billing.routes.js
const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();

function getUser(req) {
  try {
    const hdr = req.headers.authorization || '';
    const m = hdr.match(/^Bearer\s+(.+)$/i);
    if (!m) return null;
    const token = m[1];
    const secret = process.env.JWT_SECRET || 'dev_secret_change_me';
    return jwt.verify(token, secret);
  } catch { return null; }
}

router.get('/plans', (_req, res) => {
  const plans = [
    { id: 'free', name: 'Free', price: 0, currency: 'GBP', interval: 'month', features: ['Document vault (R2)','Manual uploads','Basic analytics'] },
    { id: 'starter', name: 'Starter', price: 9, currency: 'GBP', interval: 'month', features: ['Everything in Free','Automated validation','Bank feeds (sandbox)'] },
    { id: 'pro', name: 'Pro', price: 29, currency: 'GBP', interval: 'month', features: ['Everything in Starter','Advanced analytics','Priority support'] }
  ];
  res.json({ plans });
});

router.get('/payment-methods', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ items: [] });
});

module.exports = router;
