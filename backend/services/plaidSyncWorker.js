// backend/services/plaidSyncWorker.js
const path = require('path');
const PlaidItem = require('../models/PlaidItem');
const Transaction = require('../models/Transaction');
const { decrypt } = require('../utils/secure');
const {
  isSandbox,
  syncFreshnessMs,
  getPlaidClient,
} = require('../utils/plaidConfig');

const SANDBOX_DATA = (() => {
  if (!isSandbox) return null;
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const transactionsSeed = require(path.join(__dirname, '..', '..', 'data', 'transactions.json'));
    return Array.isArray(transactionsSeed?.transactions) ? transactionsSeed.transactions : [];
  } catch (err) {
    console.warn('⚠️  Sandbox transactions seed missing:', err.message);
    return [];
  }
})();

function normaliseCategory(cat) {
  if (!cat) return null;
  if (Array.isArray(cat)) return cat.map((value) => String(value));
  return [String(cat)];
}

async function upsertTransactionFromPlaid(item, tx) {
  const payload = {
    userId: item.userId,
    itemId: item._id,
    plaidItemId: item.plaidItemId,
    plaidAccountId: tx.account_id || tx.accountId || null,
    plaidTransactionId: tx.transaction_id || tx.transactionId || tx.id || null,
    name: tx.name || tx.description || 'Transaction',
    amount: typeof tx.amount === 'number' ? tx.amount : Number(tx.amount || 0),
    currency: tx.iso_currency_code || tx.isoCurrencyCode || tx.currency || 'GBP',
    date: tx.date ? new Date(tx.date) : new Date(),
    pending: Boolean(tx.pending),
    categories: normaliseCategory(tx.category || tx.categories || []),
    merchantName: tx.merchant_name || tx.merchantName || null,
    raw: tx,
    removedAt: tx.removed ? new Date() : null,
  };

  if (!payload.plaidTransactionId) {
    payload.plaidTransactionId = `sandbox-${item.plaidItemId}-${payload.plaidAccountId || 'account'}-${payload.date.getTime()}-${payload.amount}`;
  }

  const doc = await Transaction.findOneAndUpdate(
    { userId: item.userId, plaidTransactionId: payload.plaidTransactionId },
    { $set: payload },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return doc;
}

async function syncTransactionsFromSandbox(item) {
  const now = new Date();
  const seeded = Array.isArray(SANDBOX_DATA) ? SANDBOX_DATA : [];
  const ids = [];
  const seenIds = new Set();

  let counter = 0;
  for (const tx of seeded) {
    counter += 1;
    const txWithId = {
      ...tx,
      transaction_id: `sandbox-${item.plaidItemId}-${counter}`,
      account_id: tx.accountId || tx.account_id || 'sandbox-account',
      iso_currency_code: tx.currency || 'GBP',
    };
    const doc = await upsertTransactionFromPlaid(item, txWithId);
    seenIds.add(doc.plaidTransactionId);
    ids.push(doc._id);
  }

  // Mark missing transactions as removed
  const existing = await Transaction.find({ itemId: item._id, userId: item.userId });
  for (const doc of existing) {
    if (!seenIds.has(doc.plaidTransactionId) && !doc.removedAt) {
      doc.removedAt = now;
      await doc.save();
    }
  }

  item.transactions = ids;
  item.transactionsCursor = `sandbox-${now.getTime()}`;
  item.transactionsLastSyncedAt = now;
  item.transactionsFreshUntil = new Date(now.getTime() + syncFreshnessMs);
  await item.save();
  return item;
}

async function syncTransactionsFromPlaid(item) {
  const client = getPlaidClient();
  if (!client) throw new Error('Plaid client unavailable');

  const token = decrypt(item.accessToken);
  if (!token) throw new Error('Missing Plaid access token');

  let cursor = item.transactionsCursor || null;
  const added = [];
  const modified = [];
  const removed = [];

  if (typeof client.transactionsSync === 'function') {
    let hasMore = true;
    while (hasMore) {
      const response = await client.transactionsSync({
        access_token: token,
        cursor: cursor || undefined,
      });
      const data = response.data || {};
      added.push(...(data.added || []));
      modified.push(...(data.modified || []));
      removed.push(...(data.removed || []));
      cursor = data.next_cursor || cursor;
      hasMore = Boolean(data.has_more);
    }
  } else {
    const end = new Date();
    const start = new Date(Date.now() - (90 * 24 * 60 * 60 * 1000));
    const response = await client.transactionsGet({
      access_token: token,
      start_date: start.toISOString().slice(0, 10),
      end_date: end.toISOString().slice(0, 10),
    });
    const data = response.data || {};
    added.push(...(data.transactions || []));
    cursor = data.next_cursor || null;
  }

  for (const tx of [...added, ...modified]) {
    const doc = await upsertTransactionFromPlaid(item, tx);
  }

  for (const tx of removed) {
    const id = tx.transaction_id || tx.transactionId;
    if (!id) continue;
    await Transaction.updateMany(
      { userId: item.userId, plaidTransactionId: id },
      { $set: { removedAt: new Date() } },
    );
  }

  const existing = await Transaction.find({ itemId: item._id, userId: item.userId, removedAt: null });
  const finalIds = existing.map((doc) => doc._id);

  item.transactions = finalIds;
  item.transactionsCursor = cursor;
  item.transactionsLastSyncedAt = new Date();
  item.transactionsFreshUntil = new Date(Date.now() + syncFreshnessMs);
  await item.save();
  return item;
}

async function syncTransactionsForItem(item, { force = false } = {}) {
  const now = Date.now();
  const freshUntil = item.transactionsFreshUntil ? item.transactionsFreshUntil.getTime() : 0;
  if (!force && freshUntil > now) return item;

  if (isSandbox) {
    return syncTransactionsFromSandbox(item);
  }

  return syncTransactionsFromPlaid(item);
}

async function runPlaidSyncOnce({ force = false } = {}) {
  const items = await PlaidItem.find({});
  for (const item of items) {
    try {
      await syncTransactionsForItem(item, { force });
    } catch (err) {
      console.error('Plaid transactions sync failed', err.message || err);
    }
  }
}

let workerTimer;

function startPlaidSyncWorker({ intervalMs, force = false } = {}) {
  if (process.env.DISABLE_PLAID_SYNC_WORKER) {
    console.log('⚠️  Plaid sync worker disabled via DISABLE_PLAID_SYNC_WORKER');
    return;
  }
  const interval = Number(intervalMs || process.env.PLAID_SYNC_WORKER_INTERVAL_MS || (24 * 60 * 60 * 1000));
  if (workerTimer) {
    clearInterval(workerTimer);
  }
  workerTimer = setInterval(() => {
    runPlaidSyncOnce({ force: false }).catch((err) => {
      console.error('Plaid sync worker iteration failed', err);
    });
  }, interval);
  if (workerTimer.unref) workerTimer.unref();
  runPlaidSyncOnce({ force }).catch((err) => {
    console.error('Plaid sync worker initial run failed', err);
  });
}

module.exports = {
  syncTransactionsForItem,
  runPlaidSyncOnce,
  startPlaidSyncWorker,
};
