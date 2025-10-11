'use strict';

const dateRange = require('../dateRange.js');
const { STATEMENT_TYPES, preferV1 } = require('./normalisers');

function mapTransactionsWithinRange(transactions, range) {
  return transactions.filter((tx) => tx.date >= range.start && tx.date <= range.end);
}

function aggregateSummary(insights, range) {
  let incomeMinor = 0;
  let spendMinor = 0;
  const transactions = [];
  const payslips = [];

  for (const insight of insights) {
    const preferred = preferV1(insight);
    if (insight.catalogueKey === 'payslip' && preferred.metricsV1) {
      const payDate = preferred.metricsV1.payDate;
      if (payDate >= range.start && payDate <= range.end) {
        payslips.push(preferred.metricsV1);
      }
    }
    if (STATEMENT_TYPES.has(insight.catalogueKey)) {
      const filtered = mapTransactionsWithinRange(preferred.transactionsV1, range);
      filtered.forEach((tx) => {
        transactions.push(tx);
        if (tx.direction === 'inflow') {
          incomeMinor += tx.amountMinor;
        } else if (tx.direction === 'outflow' && tx.category !== 'Transfers') {
          spendMinor += Math.abs(tx.amountMinor);
        }
      });
    }
  }

  return { incomeMinor, spendMinor, netMinor: incomeMinor - spendMinor, transactions, payslips };
}

function aggregateCategories(transactions) {
  const map = new Map();
  for (const tx of transactions) {
    if (tx.direction !== 'outflow') continue;
    if (tx.category === 'Transfers') continue;
    const key = tx.category;
    const existing = map.get(key) ?? { category: key, outflowMinor: 0, inflowMinor: 0 };
    existing.outflowMinor += Math.abs(tx.amountMinor);
    map.set(key, existing);
  }
  return Array.from(map.values()).map((item) => {
    if (!item.inflowMinor) delete item.inflowMinor;
    return item;
  });
}

function aggregateLargestExpenses(transactions, limit) {
  return transactions
    .filter((tx) => tx.direction === 'outflow' && tx.category !== 'Transfers')
    .map((tx) => ({
      date: tx.date,
      description: tx.description,
      amountMinor: Math.abs(tx.amountMinor),
      category: tx.category,
      accountId: tx.accountId ?? undefined,
    }))
    .sort((a, b) => b.amountMinor - a.amountMinor)
    .slice(0, limit);
}

function aggregateAccounts(transactions) {
  const map = new Map();
  for (const tx of transactions) {
    const key = tx.accountId ?? 'unknown';
    if (!map.has(key)) {
      map.set(key, { accountId: key, name: tx.accountName ?? undefined, incomeMinor: 0, spendMinor: 0 });
    }
    const bucket = map.get(key);
    if (tx.direction === 'inflow') {
      bucket.incomeMinor += tx.amountMinor;
    } else if (tx.direction === 'outflow' && tx.category !== 'Transfers') {
      bucket.spendMinor += Math.abs(tx.amountMinor);
    }
  }
  return Array.from(map.values());
}

function aggregateTimeseries(transactions, range, granularity, metric) {
  const buckets = new Map();
  for (const tx of transactions) {
    const bucket = dateRange.bucketForGranularity(tx.date, granularity);
    if (!bucket) continue;
    if (!buckets.has(bucket)) buckets.set(bucket, 0);
    const value = buckets.get(bucket);
    if (metric === 'income' && tx.direction === 'inflow') {
      buckets.set(bucket, value + tx.amountMinor);
    } else if (metric === 'spend' && tx.direction === 'outflow' && tx.category !== 'Transfers') {
      buckets.set(bucket, value + Math.abs(tx.amountMinor));
    } else if (metric === 'net') {
      if (tx.direction === 'inflow') {
        buckets.set(bucket, value + tx.amountMinor);
      } else if (tx.direction === 'outflow' && tx.category !== 'Transfers') {
        buckets.set(bucket, value - Math.abs(tx.amountMinor));
      }
    }
  }
  const keys = dateRange.enumerateBuckets(range, granularity);
  return keys.map((key) => ({ ts: key, valueMinor: buckets.get(key) ?? 0 }));
}

module.exports = {
  mapTransactionsWithinRange,
  aggregateSummary,
  aggregateCategories,
  aggregateLargestExpenses,
  aggregateAccounts,
  aggregateTimeseries,
};
