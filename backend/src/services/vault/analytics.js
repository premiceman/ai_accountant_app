const dayjs = require('dayjs');
const DocumentInsight = require('../../../models/DocumentInsight');
const UserAnalytics = require('../../../models/UserAnalytics');
const UserOverride = require('../../../models/UserOverride');

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
    switch (insight.catalogueKey) {
      case 'payslip': {
        sources.payslips += 1;
        const metrics = insight.metrics || {};
        incomeGross += Number(metrics.gross || 0);
        incomeNet += Number(metrics.net || 0);
        hmrcWithheld += Number(metrics.tax || 0) + Number(metrics.ni || 0) + Number(metrics.studentLoan || 0);
        break;
      }
      case 'current_account_statement':
      case 'savings_account_statement':
      case 'isa_statement':
      case 'investment_statement':
      case 'pension_statement': {
        sources.statements += insight.catalogueKey === 'current_account_statement' ? 1 : 0;
        if (insight.catalogueKey === 'savings_account_statement') sources.savings += 1;
        if (insight.catalogueKey === 'isa_statement') sources.isa += 1;
        if (insight.catalogueKey === 'investment_statement') sources.investments += 1;
        if (insight.catalogueKey === 'pension_statement') sources.pension += 1;
        const txs = applyTransactionOverrides(insight.transactions || [], overrides);
        statementTransactions.push(...txs);
        const metrics = insight.metrics || {};
        if (insight.catalogueKey === 'savings_account_statement') {
          savings.balance = Number(metrics.closingBalance || savings.balance);
          savings.interest += Number(metrics.interestOrDividends || 0);
        }
        if (insight.catalogueKey === 'isa_statement' || insight.catalogueKey === 'investment_statement') {
          investments.balance = Number(metrics.closingBalance || investments.balance);
          investments.contributions += Number(metrics.contributions || 0);
          if (metrics.estReturn != null) {
            investments.estReturn += Number(metrics.estReturn);
          }
        }
        if (insight.catalogueKey === 'pension_statement') {
          pension.balance = Number(metrics.closingBalance || pension.balance);
          pension.contributions += Number(metrics.contributions || 0);
        }
        break;
      }
      case 'hmrc_correspondence':
        sources.hmrc += 1;
        const metrics = insight.metrics || {};
        hmrcPaid += Number(metrics.taxPaid || 0);
        break;
      default:
        break;
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
