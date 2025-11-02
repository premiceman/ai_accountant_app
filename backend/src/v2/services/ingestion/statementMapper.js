const { badRequest } = require('../../utils/errors');
const { sha256 } = require('../../utils/hashing');
const { toPence } = require('../../utils/money');

function ensureDate(value, label) {
  const str = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  throw badRequest(`Invalid ${label} date`);
}

function mapStatement(doc, { fileId, contentHash }) {
  if (!doc) throw badRequest('Missing Docupipe payload');
  const payload = doc.standardized || doc.standardised || doc.payload || doc;
  const account = payload.account || {};
  const period = payload.period || {};
  const provenance = {
    fileId,
    page: Number(payload.page || 1),
    anchor: payload.anchor || 'document',
  };
  const transactions = Array.isArray(payload.transactions) ? payload.transactions : [];

  const mappedTransactions = transactions.map((tx, index) => {
    const prov = {
      fileId,
      page: Number(tx.page || payload.page || 1),
      anchor: tx.anchor || `transactions.${index}`,
    };
    const date = ensureDate(tx.date, `transactions[${index}].date`);
    const amount = toPence(tx.amount ?? tx.value ?? 0);
    const id = tx.id || tx.transactionId || sha256(Buffer.from(`${fileId}:${date}:${amount}:${tx.description || index}`)).slice(0, 16);
    return {
      transactionId: id,
      fileId,
      contentHash,
      accountId: account.accountId || account.id || payload.accountId || 'account',
      date,
      amount,
      currency: tx.currency || payload.currency || account.currency || 'GBP',
      description: tx.description || tx.narrative || 'Transaction',
      category: tx.category || undefined,
      subcategory: tx.subcategory || undefined,
      counterparty: tx.counterparty ? {
        name: tx.counterparty.name || undefined,
        iban: tx.counterparty.iban || undefined,
      } : undefined,
      balance: tx.balance ? {
        amount: toPence(tx.balance.amount ?? tx.balance.value ?? 0),
        currency: tx.balance.currency || payload.currency || account.currency || 'GBP',
      } : undefined,
      provenance: prov,
    };
  });

  const mapped = {
    docType: 'statement',
    fileId,
    contentHash,
    account: {
      accountId: account.accountId || account.id || payload.accountId || 'account',
      name: account.name || payload.accountName || 'Account',
      sortCode: account.sortCode || undefined,
      accountNumber: account.accountNumber || undefined,
      currency: account.currency || payload.currency || 'GBP',
      provenance,
    },
    period: {
      start: ensureDate(period.start || payload.startDate, 'period.start'),
      end: ensureDate(period.end || payload.endDate, 'period.end'),
      openingBalance: payload.openingBalance ? {
        amount: toPence(payload.openingBalance.amount ?? payload.openingBalance.value ?? 0),
        currency: payload.openingBalance.currency || account.currency || 'GBP',
        provenance,
      } : undefined,
      closingBalance: payload.closingBalance ? {
        amount: toPence(payload.closingBalance.amount ?? payload.closingBalance.value ?? 0),
        currency: payload.closingBalance.currency || account.currency || 'GBP',
        provenance,
      } : undefined,
    },
    transactions: mappedTransactions,
    provenance,
  };

  return mapped;
}

module.exports = { mapStatement };
