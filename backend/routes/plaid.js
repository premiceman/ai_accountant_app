// backend/routes/plaid.js
const express = require('express');
const auth = require('../middleware/auth');
const PlaidItem = require('../models/PlaidItem');
const Transaction = require('../models/Transaction');
const { encrypt, decrypt } = require('../utils/secure');
const { syncTransactionsForItem } = require('../services/plaidSyncWorker');
const {
  getPlaidClient,
  isSandbox,
  allowLive,
  productScopes,
  countryCodes,
  syncFreshnessMs,
} = require('../utils/plaidConfig');

let plaidClient = null;
function ensureClient() {
  if (plaidClient) return plaidClient;
  plaidClient = getPlaidClient();
  return plaidClient;
}

const router = express.Router();

const sandboxAccounts = (() => {
  if (!isSandbox) return [];
  try {
    // eslint-disable-next-line global-require
    const { accounts } = require('../../data/accounts.json');
    return Array.isArray(accounts) ? accounts : [];
  } catch (err) {
    console.warn('⚠️  Sandbox accounts seed missing:', err.message);
    return [];
  }
})();

function plaidErrorMessage(err) {
  if (err?.response?.data?.error_message) return err.response.data.error_message;
  if (err?.response?.data?.error_code) return `${err.response.data.error_code}: ${err.response.data.error_message || err.message}`;
  return err?.message || 'Plaid request failed';
}

function mapAccount(account) {
  if (!account) return null;
  return {
    accountId: account.account_id,
    name: account.name || null,
    officialName: account.official_name || null,
    mask: account.mask || null,
    subtype: account.subtype || null,
    type: account.type || null,
    verificationStatus: account.verification_status || null,
    balances: account.balances || {},
    currency: account.balances?.iso_currency_code || account.balances?.isoCurrencyCode || null,
  };
}

function normalizeInstitution(meta = {}) {
  if (!meta) return {};
  let logo = meta.logo || null;
  if (logo && typeof logo === 'string' && !logo.startsWith('http') && !logo.startsWith('data:')) {
    logo = `data:image/png;base64,${logo}`;
  }
  return {
    id: meta.institution_id || meta.id || null,
    name: meta.name || meta.institution_name || null,
    logo,
    primaryColor: meta.primary_color || null,
    url: meta.url || null,
  };
}

function buildStatus(item) {
  if (!item) return { code: 'unknown' };
  const statusObj = item.status || {};
  const txStatus = statusObj.transactions || {};
  const statusCodeRaw = txStatus.status || (item.error ? 'ERROR' : 'HEALTHY');
  const statusCode = typeof statusCodeRaw === 'string' ? statusCodeRaw.toLowerCase() : 'unknown';
  const lastError = item.error
    ? {
        code: item.error.error_code,
        message: item.error.error_message || item.error.display_message || 'Plaid reported an error.',
      }
    : (txStatus.last_failed_update
        ? { message: `Last failed update ${txStatus.last_failed_update}` }
        : null);

  let description = '';
  if (txStatus.last_successful_update) {
    description = `Last successful update ${txStatus.last_successful_update}`;
  }
  if (item.error?.display_message) description = item.error.display_message;

  return {
    code: statusCode,
    description,
    lastSuccessfulUpdate: txStatus.last_successful_update || null,
    lastFailedUpdate: txStatus.last_failed_update || null,
    lastError,
  };
}

function presentItem(doc) {
  return {
    id: String(doc._id),
    itemId: doc.plaidItemId,
    institution: doc.institution || {},
    accounts: Array.isArray(doc.accounts) ? doc.accounts : [],
    status: doc.status || {},
    consentExpirationTime: doc.consentExpirationTime ? doc.consentExpirationTime.toISOString() : null,
    connectedUntil: doc.consentExpirationTime ? doc.consentExpirationTime.toISOString() : null,
    lastSuccessfulUpdate: doc.lastSuccessfulUpdate ? doc.lastSuccessfulUpdate.toISOString() : null,
    lastFailedUpdate: doc.lastFailedUpdate ? doc.lastFailedUpdate.toISOString() : null,
    lastSyncAttempt: doc.lastSyncAttempt ? doc.lastSyncAttempt.toISOString() : null,
    lastSyncedAt: doc.lastSyncedAt ? doc.lastSyncedAt.toISOString() : null,
    transactionsLastSyncedAt: doc.transactionsLastSyncedAt ? doc.transactionsLastSyncedAt.toISOString() : null,
    transactionsFreshUntil: doc.transactionsFreshUntil ? doc.transactionsFreshUntil.toISOString() : null,
    transactionCount: Array.isArray(doc.transactions) ? doc.transactions.length : 0,
    createdAt: doc.createdAt ? doc.createdAt.toISOString() : null,
    updatedAt: doc.updatedAt ? doc.updatedAt.toISOString() : null,
  };
}

async function syncItemFromPlaid(doc, { accessToken } = {}) {
  const now = new Date();
  doc.lastSyncAttempt = now;

  if (isSandbox) {
    if (!doc.accounts || doc.accounts.length === 0) {
      doc.accounts = sandboxAccounts.map((account) => ({
        accountId: account.id,
        name: account.name,
        officialName: account.name,
        mask: account.id ? String(account.id).slice(-4) : null,
        subtype: account.type,
        type: account.type,
        balances: { current: account.balance, available: account.balance },
        currency: 'GBP',
      }));
    }
    doc.lastSyncedAt = now;
    doc.status = { code: 'sandbox', description: 'Sandbox seed data' };
    await doc.save();
    return doc;
  }

  const client = ensureClient();
  const token = accessToken || decrypt(doc.accessToken);
  if (!client || !token) throw new Error('Missing Plaid client or access token for item.');

  const [balanceResp, itemResp] = await Promise.all([
    client.accountsBalanceGet({ access_token: token }),
    client.itemGet({ access_token: token }),
  ]);

  const accounts = (balanceResp.data.accounts || []).map(mapAccount).filter(Boolean);
  const balanceItem = balanceResp.data.item || {};
  const itemData = itemResp.data.item || {};

  doc.accounts = accounts;
  doc.lastSyncedAt = now;
  doc.lastSuccessfulUpdate = balanceItem.last_successful_update
    ? new Date(balanceItem.last_successful_update)
    : (itemData?.status?.transactions?.last_successful_update
      ? new Date(itemData.status.transactions.last_successful_update)
      : doc.lastSuccessfulUpdate || null);
  doc.lastFailedUpdate = balanceItem.last_failed_update
    ? new Date(balanceItem.last_failed_update)
    : (itemData?.status?.transactions?.last_failed_update
      ? new Date(itemData.status.transactions.last_failed_update)
      : doc.lastFailedUpdate || null);

  const consent = balanceItem.consent_expiration_time || itemData.consent_expiration_time;
  doc.consentExpirationTime = consent ? new Date(consent) : null;
  doc.status = buildStatus(itemData);

  if (!doc.institution || Object.keys(doc.institution).length === 0) {
    doc.institution = normalizeInstitution(itemData?.institution || {});
  }

  await doc.save();
  return doc;
}

async function ensureFreshItem(doc, { force = false } = {}) {
  const stale = !doc.lastSyncedAt || (Date.now() - doc.lastSyncedAt.getTime()) > syncFreshnessMs;
  if (!force && !stale) return doc;
  try {
    await syncItemFromPlaid(doc);
  } catch (err) {
    console.error('Plaid sync failed', err);
    doc.status = {
      ...(doc.status || {}),
      code: 'error',
      description: plaidErrorMessage(err),
      lastError: { message: plaidErrorMessage(err) },
    };
    doc.lastSyncAttempt = new Date();
    await doc.save();
  }
  return doc;
}

async function ensureTransactionsFresh(doc, { force = false } = {}) {
  try {
    await syncTransactionsForItem(doc, { force });
  } catch (err) {
    console.error('Plaid transaction sync failed', err);
  }
  return doc;
}

router.post('/link/launch', auth, async (req, res) => {
  const { mode = 'create', itemId = null } = req.body || {};
  try {
    if (!isSandbox && !allowLive) {
      return res.status(412).json({
        error: 'Live Plaid link creation disabled. Set PLAID_ENV_OVERRIDE to enable live mode.',
      });
    }

    if (isSandbox) {
      const docs = await PlaidItem.find({ userId: req.user.id }).sort({ createdAt: 1 });
      const items = [];
      for (const doc of docs) {
        await ensureTransactionsFresh(doc, { force: false });
        items.push(presentItem(doc));
      }
      return res.json({
        token: null,
        sandbox: true,
        items,
        message: 'Sandbox mode: seeded items are returned instead of launching Plaid Link.',
      });
    }

    const products = productScopes.link;

    const request = {
      user: { client_user_id: String(req.user.id) },
      client_name: process.env.PLAID_CLIENT_NAME || 'Phloat',
      products,
      country_codes: countryCodes,
      language: 'en',
    };

    if (process.env.PLAID_REDIRECT_URI) {
      request.redirect_uri = process.env.PLAID_REDIRECT_URI;
    }
    if (process.env.PLAID_WEBHOOK_URL) {
      request.webhook = process.env.PLAID_WEBHOOK_URL;
    }

    if (mode === 'update') {
      if (!itemId) return res.status(400).json({ error: 'itemId required for update mode' });
      const existing = await PlaidItem.findOne({ _id: itemId, userId: req.user.id });
      if (!existing) return res.status(404).json({ error: 'Plaid connection not found' });
      const token = decrypt(existing.accessToken);
      if (!token) return res.status(400).json({ error: 'Plaid access token unavailable for update' });
      request.access_token = token;
      delete request.products; // Plaid requires omitting products when updating an existing item
    }

    const client = ensureClient();
    if (!client) {
      return res.status(500).json({ error: 'Plaid client unavailable' });
    }
    const response = await client.linkTokenCreate(request);
    res.json({ token: response.data.link_token, expiration: response.data.expiration });
  } catch (err) {
    console.error('Plaid link launch failed', err);
    res.status(500).json({ error: plaidErrorMessage(err) });
  }
});

router.post('/link/exchange', auth, async (req, res) => {
  const { publicToken, metadata = {}, mode = 'create', itemId = null } = req.body || {};
  if (!publicToken) {
    return res.status(400).json({ error: 'publicToken is required' });
  }
  try {
    if (isSandbox) {
      const seedId = metadata?.institution?.institution_id || 'sandbox';
      const plaidItemId = `sandbox-${seedId}`;

      let doc;
      if (mode === 'update' && itemId) {
        doc = await PlaidItem.findOne({ _id: itemId, userId: req.user.id });
        if (!doc) return res.status(404).json({ error: 'Plaid connection not found' });
      } else {
        doc = await PlaidItem.findOne({ userId: req.user.id, plaidItemId });
        if (!doc) {
          doc = new PlaidItem({
            userId: req.user.id,
            plaidItemId,
            accessToken: encrypt(`sandbox-token-${seedId}`),
          });
        }
      }

      if (metadata?.institution) {
        doc.institution = normalizeInstitution(metadata.institution);
      } else if (!doc.institution || Object.keys(doc.institution).length === 0) {
        doc.institution = {
          id: plaidItemId,
          name: 'Sandbox Bank',
        };
      }

      await syncItemFromPlaid(doc, { accessToken: `sandbox-token-${seedId}` });
      await ensureTransactionsFresh(doc, { force: true });

      const items = await PlaidItem.find({ userId: req.user.id }).sort({ createdAt: 1 });
      const hydrated = [];
      for (const itemDoc of items) {
        await ensureTransactionsFresh(itemDoc, { force: false });
        hydrated.push(presentItem(itemDoc));
      }
      return res.json({ ok: true, sandbox: true, item: presentItem(doc), items: hydrated });
    }

    const client = ensureClient();
    if (!client) {
      return res.status(500).json({ error: 'Plaid client unavailable' });
    }

    const exchange = await client.itemPublicTokenExchange({ public_token: publicToken });
    const accessToken = exchange.data.access_token;
    const plaidItemId = exchange.data.item_id;

    let doc;
    if (mode === 'update' && itemId) {
      doc = await PlaidItem.findOne({ _id: itemId, userId: req.user.id });
      if (!doc) return res.status(404).json({ error: 'Plaid connection not found' });
      doc.plaidItemId = plaidItemId;
      doc.accessToken = encrypt(accessToken);
    } else {
      doc = await PlaidItem.findOne({ userId: req.user.id, plaidItemId });
      if (doc) {
        doc.accessToken = encrypt(accessToken);
      } else {
        doc = new PlaidItem({
          userId: req.user.id,
          plaidItemId,
          accessToken: encrypt(accessToken),
        });
      }
    }

    if (metadata?.institution) {
      doc.institution = normalizeInstitution(metadata.institution);
    }

    await syncItemFromPlaid(doc, { accessToken });
    await ensureTransactionsFresh(doc, { force: true });
    res.json({ ok: true, item: presentItem(doc) });
  } catch (err) {
    console.error('Plaid token exchange failed', err);
    res.status(500).json({ error: plaidErrorMessage(err) });
  }
});

router.get('/items', auth, async (req, res) => {
  try {
    const docs = await PlaidItem.find({ userId: req.user.id }).sort({ createdAt: 1 });
    const items = [];
    for (const doc of docs) {
      await ensureFreshItem(doc);
      await ensureTransactionsFresh(doc);
      items.push(presentItem(doc));
    }
    res.json({ items });
  } catch (err) {
    console.error('Failed to list Plaid items', err);
    res.status(500).json({ error: plaidErrorMessage(err) });
  }
});

router.delete('/items/:id', auth, async (req, res) => {
  const { id } = req.params;
  try {
    const doc = await PlaidItem.findOne({ _id: id, userId: req.user.id });
    if (!doc) return res.status(404).json({ error: 'Plaid connection not found' });
    const token = decrypt(doc.accessToken);
    if (!isSandbox && token) {
      const client = ensureClient();
      if (client) {
        try {
          await client.itemRemove({ access_token: token });
        } catch (err) {
          console.warn('Plaid item removal warning', err?.response?.data || err.message);
        }
      }
    }
    await doc.deleteOne();
    await Transaction.deleteMany({ itemId: doc._id });
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete Plaid item', err);
    res.status(500).json({ error: plaidErrorMessage(err) });
  }
});

module.exports = router;
