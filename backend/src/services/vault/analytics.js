const dayjs = require('dayjs');
const DocumentInsight = require('../../../models/DocumentInsight');
const UserAnalytics = require('../../../models/UserAnalytics');
const UserOverride = require('../../../models/UserOverride');
const { preferV1, STATEMENT_TYPES } = require('../../lib/analyticsV1');

function groupByCategory(transactions) {
  const totals = new Map();
  for (const tx of transactions) {
    if (!tx || typeof tx !== 'object') continue;
    if (tx.direction !== 'outflow') continue;
    if (tx.category === 'Transfers') continue;
    const amount = Math.abs(Number(tx.amount) || 0);
    if (!amount) continue;
    const key = tx.category || 'Misc';
    totals.set(key, (totals.get(key) || 0) + amount);
  }
  const totalOutflow = Array.from(totals.values()).reduce((acc, val) => acc + val, 0);
  return {
    totalOutflow,
    buckets: Array.from(totals.entries()).map(([category, outflow]) => ({
      category,
      outflow,
      share: totalOutflow ? outflow / totalOutflow : 0,
    })),
  };
}

function applyTransactionOverrides(transactions, overrides) {
  const patches = overrides.filter((ovr) => ovr.scope === 'transaction');
  if (!patches.length) return transactions;
  return transactions.map((tx) => {
    if (!tx?.id) return tx;
    const relevant = patches.filter((patch) => patch.targetId === tx.id);
    if (!relevant.length) return tx;
    return relevant.reduce((acc, patch) => Object.assign({}, acc, patch.patch), tx);
  });
}

function applyMetricOverrides(doc, overrides) {
  const patches = overrides.filter((ovr) => ovr.scope === 'metric');
  if (!patches.length) return doc;
  const clone = JSON.parse(JSON.stringify(doc));
  for (const patch of patches) {
    if (!patch.targetId) continue;
    const segments = String(patch.targetId).split('.');
    let cursor = clone;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const seg = segments[i];
      if (cursor[seg] == null || typeof cursor[seg] !== 'object') {
        cursor[seg] = {};
      }
      cursor = cursor[seg];
    }
    cursor[segments[segments.length - 1]] = patch.patch;
  }
  return clone;
}

function fromMinor(minor) {
  const value = Number(minor);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value) / 100;
}

function numberOrZero(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function mapTransactionFromV1(tx, metadata, fallbackCurrency) {
  if (!tx) return null;
  const amountMinor = Number(tx.amountMinor);
  const amountMajor = Number.isFinite(amountMinor) ? amountMinor / 100 : 0;
  const direction = tx.direction === 'outflow' ? 'outflow' : 'inflow';
  const signedAmount = direction === 'outflow' ? -Math.abs(amountMajor) : Math.abs(amountMajor);
  return {
    id: tx.id || null,
    description: tx.description || 'Transaction',
    amount: signedAmount,
    direction,
    category: tx.category || 'Misc',
    date: tx.date || metadata?.period?.end || metadata?.period?.start || null,
    accountId: tx.accountId || metadata?.accountId || null,
    accountName: tx.accountName || metadata?.accountName || null,
    bankName: metadata?.bankName || null,
    accountType: metadata?.accountType || null,
    statementPeriod: metadata?.period || null,
    currency: fallbackCurrency,
    transfer: (tx.category || '').toLowerCase() === 'transfers',
  };
}

async function rebuildMonthlyAnalytics({ userId, month }) {
  const periodStart = dayjs(`${month}-01`);
  if (!periodStart.isValid()) {
    throw new Error(`Invalid period month ${month}`);
  }
  const insights = await DocumentInsight.find({ userId, documentMonth: month });
  const overrides = await UserOverride.find({ userId, appliesFrom: { $lte: `${month}-31` } });

  let incomeGross = 0;
  let incomeNet = 0;
  let incomeOther = 0;
  let spendTotal = 0;
  let cashIn = 0;
  let cashOut = 0;
  let hmrcWithheld = 0;
  let hmrcPaid = 0;

  const statementTransactions = [];

  const sources = {
    payslips: 0,
    statements: 0,
    savings: 0,
    isa: 0,
    investments: 0,
    hmrc: 0,
    pension: 0,
  };

  const savings = { balance: 0, interest: 0 };
  const investments = { balance: 0, contributions: 0, estReturn: 0 };
  const pension = { balance: 0, contributions: 0 };

  for (const insight of insights) {
    const preferred = preferV1(insight);
    const metrics = insight.metrics || {};
    const metadata = insight.metadata || {};
    const currency = preferred?.currency || insight.currency || 'GBP';

    switch (insight.catalogueKey) {
      case 'payslip': {
        sources.payslips += 1;
        const metricsV1 = preferred?.metricsV1 || {};
        incomeGross += metricsV1.grossMinor != null ? fromMinor(metricsV1.grossMinor) : numberOrZero(metrics.gross);
        incomeNet += metricsV1.netMinor != null ? fromMinor(metricsV1.netMinor) : numberOrZero(metrics.net);
        hmrcWithheld +=
          (metricsV1.taxMinor != null ? fromMinor(metricsV1.taxMinor) : numberOrZero(metrics.tax)) +
          (metricsV1.nationalInsuranceMinor != null
            ? fromMinor(metricsV1.nationalInsuranceMinor)
            : numberOrZero(metrics.ni)) +
          (metricsV1.studentLoanMinor != null ? fromMinor(metricsV1.studentLoanMinor) : numberOrZero(metrics.studentLoan));
        break;
      }
      case 'hmrc_correspondence': {
        sources.hmrc += 1;
        hmrcPaid += numberOrZero(metrics.taxPaid ?? metrics.taxDue);
        break;
      }
      default: {
        if (!STATEMENT_TYPES.has(insight.catalogueKey)) break;

        if (insight.catalogueKey === 'current_account_statement') sources.statements += 1;
        if (insight.catalogueKey === 'savings_account_statement') sources.savings += 1;
        if (insight.catalogueKey === 'isa_statement') sources.isa += 1;
        if (insight.catalogueKey === 'investment_statement') sources.investments += 1;
        if (insight.catalogueKey === 'pension_statement') sources.pension += 1;

        const transactionsV1 = Array.isArray(preferred?.transactionsV1) ? preferred.transactionsV1 : null;
        const normalised = transactionsV1 && transactionsV1.length
          ? transactionsV1
              .map((tx) => mapTransactionFromV1(tx, metadata, currency))
              .filter(Boolean)
          : Array.isArray(insight.transactions)
          ? insight.transactions.map((tx) => ({
              ...tx,
              amount: numberOrZero(tx.amount),
              direction: tx.direction || (numberOrZero(tx.amount) >= 0 ? 'inflow' : 'outflow'),
              transfer:
                tx.transfer != null
                  ? Boolean(tx.transfer)
                  : (tx.category || '').toLowerCase() === 'transfers',
            }))
          : [];
        const txs = applyTransactionOverrides(normalised, overrides);
        statementTransactions.push(...txs);

        if (insight.catalogueKey === 'savings_account_statement') {
          savings.balance = numberOrZero(metrics.closingBalance ?? metrics.balance ?? savings.balance);
          savings.interest += numberOrZero(metrics.interestOrDividends ?? metrics.interest);
        }
        if (insight.catalogueKey === 'isa_statement' || insight.catalogueKey === 'investment_statement') {
          investments.balance = numberOrZero(metrics.closingBalance ?? metrics.balance ?? investments.balance);
          investments.contributions += numberOrZero(metrics.contributions ?? metrics.netContributions);
          if (metrics.estReturn != null) {
            investments.estReturn += numberOrZero(metrics.estReturn);
          }
        }
        if (insight.catalogueKey === 'pension_statement') {
          pension.balance = numberOrZero(metrics.closingBalance ?? metrics.balance ?? pension.balance);
          pension.contributions += numberOrZero(metrics.contributions ?? metrics.employeeContributions);
        }
        break;
      }
    }
  }

  if (statementTransactions.length) {
    for (const tx of statementTransactions) {
      const amount = Number(tx.amount) || 0;
      if (tx.direction === 'inflow') {
        cashIn += amount;
        if ((tx.category || '').toLowerCase() === 'income') {
          incomeOther += amount;
        }
        if (/(hmrc|tax)/i.test(tx.description || '')) {
          hmrcPaid += amount;
        }
      } else if (tx.direction === 'outflow') {
        const abs = Math.abs(amount);
        cashOut += abs;
        if ((tx.category || '').toLowerCase() !== 'transfers') {
          spendTotal += abs;
        }
        if (/(hmrc|tax)/i.test(tx.description || '')) {
          hmrcPaid += abs;
        }
      }
    }
  }

  const { totalOutflow, buckets } = groupByCategory(statementTransactions);
  if (!spendTotal) spendTotal = totalOutflow;

  const analyticsDoc = applyMetricOverrides({
    userId,
    period: month,
    builtAt: new Date(),
    sources,
    income: {
      gross: incomeGross,
      net: incomeNet,
      other: incomeOther,
    },
    spend: {
      total: spendTotal,
      byCategory: buckets,
      largestExpenses: [],
    },
    cashflow: {
      inflows: cashIn,
      outflows: cashOut,
      net: cashIn - cashOut,
    },
    savings,
    investments,
    pension,
    tax: {
      withheld: hmrcWithheld,
      paidToHMRC: hmrcPaid,
      effectiveRate: incomeGross ? (hmrcWithheld + hmrcPaid) / incomeGross : 0,
    },
    derived: {
      savingsRate: incomeNet ? (incomeNet - spendTotal) / incomeNet : 0,
      topMerchants: [],
    },
  }, overrides);

  await UserAnalytics.findOneAndUpdate(
    { userId, period: month },
    { $set: analyticsDoc },
    { upsert: true, new: true }
  );
}

module.exports = { rebuildMonthlyAnalytics };
