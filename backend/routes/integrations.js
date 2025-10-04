// backend/routes/integrations.js
const express = require('express');
const auth = require('../middleware/auth');
const User = require('../models/User');

const router = express.Router();

const VALID_STATUSES = ['not_connected','pending','error','connected'];

const CATALOG = [
  {
    key: 'truelayer',
    label: 'TrueLayer Open Banking',
    category: 'Bank connections',
    description: 'Launch a Revolut-style open banking flow to sync balances, transactions and statements across UK institutions.',
    env: ['TRUELAYER_CLIENT_ID', 'TRUELAYER_CLIENT_SECRET', 'TRUELAYER_REDIRECT_URI'],
    docsUrl: 'https://docs.truelayer.com/',
    help: 'Ensure your TrueLayer credentials are configured in Render. Once active, customers can launch the familiar bank selection flow to link accounts instantly.'
  },
  {
    key: 'hmrc',
    label: 'HMRC Making Tax Digital',
    category: 'Government filings',
    description: 'Connect to HMRC for Self Assessment, VAT and PAYE data in real time.',
    comingSoon: true,
    docsUrl: 'https://developer.service.hmrc.gov.uk/',
    help: 'HMRC APIs require production credentials and agent authorisation. We will guide you through the flow once the sandbox is approved.'
  },
  {
    key: 'companies-house',
    label: 'Companies House',
    category: 'Compliance',
    description: 'Pull filing deadlines, PSC registers and corporate data for UK companies.',
    env: ['COMPANIES_HOUSE_API_KEY'],
    docsUrl: 'https://developer.company-information.service.gov.uk/',
    help: 'Generate an API key in the Companies House developer hub and add it to your Render environment variables to enable automatic filing insights.'
  },
  {
    key: 'xero',
    label: 'Xero Accounting',
    category: 'Accounting platforms',
    description: 'Synchronise journals, VAT returns and expense coding from Xero.',
    env: ['XERO_CLIENT_ID', 'XERO_CLIENT_SECRET'],
    docsUrl: 'https://developer.xero.com/documentation/api-guides/partner-app-setup',
    help: 'Create an OAuth2 app within the Xero developer portal, then paste the client credentials into Render to unlock seamless ledger syncing.'
  },
  {
    key: 'quickbooks',
    label: 'QuickBooks Online',
    category: 'Accounting platforms',
    description: 'Bring invoices, payroll and expense data from QuickBooks Online.',
    env: ['QBO_CLIENT_ID', 'QBO_CLIENT_SECRET'],
    docsUrl: 'https://developer.intuit.com/app/developer/qbo/docs/get-started',
    help: 'Set your Intuit app credentials in Render. Once present, launch the OAuth2 consent to connect your QuickBooks company.'
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

// GET /api/integrations
router.get('/', auth, async (req, res) => {
  const user = await User.findById(req.user.id).lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ integrations: user.integrations || [], catalog: cataloguePayload() });
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
