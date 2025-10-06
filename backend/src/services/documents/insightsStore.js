const User = require('../../../models/User');

function mergeFileReference(existing = [], fileInfo) {
  const filtered = existing.filter((item) => item.id !== fileInfo.id);
  filtered.unshift({
    id: fileInfo.id,
    name: fileInfo.name,
    uploadedAt: fileInfo.uploadedAt,
  });
  return filtered.slice(0, 5);
}

function buildAggregates(sources) {
  const aggregates = {
    income: {},
    cashflow: {},
    savings: {},
    pension: {},
    tax: {},
  };

  const payslip = sources.payslip;
  if (payslip?.metrics) {
    aggregates.income = {
      gross: payslip.metrics.gross ?? null,
      net: payslip.metrics.net ?? null,
      tax: payslip.metrics.tax ?? null,
      ni: payslip.metrics.ni ?? null,
      pension: payslip.metrics.pension ?? null,
    };
  }

  const currentAccount = sources.current_account_statement;
  if (currentAccount?.metrics) {
    aggregates.cashflow = {
      income: currentAccount.metrics.income ?? 0,
      spend: currentAccount.metrics.spend ?? 0,
      categories: currentAccount.metrics.categories || [],
    };
  }

  const savingsBalance = [];
  if (sources.savings_account_statement?.metrics?.balance != null) {
    savingsBalance.push(sources.savings_account_statement.metrics.balance);
  }
  if (sources.isa_statement?.metrics?.balance != null) {
    savingsBalance.push(sources.isa_statement.metrics.balance);
  }
  if (savingsBalance.length) {
    aggregates.savings = {
      balance: savingsBalance.reduce((acc, v) => acc + (Number(v) || 0), 0),
      interest: sources.savings_account_statement?.metrics?.interest ?? null,
    };
  }

  if (sources.pension_statement?.metrics) {
    aggregates.pension = {
      balance: sources.pension_statement.metrics.balance ?? null,
      contributions: sources.pension_statement.metrics.contributions ?? null,
    };
  }

  if (sources.hmrc_correspondence?.metrics?.taxDue != null) {
    aggregates.tax = {
      taxDue: sources.hmrc_correspondence.metrics.taxDue,
    };
  }

  return aggregates;
}

async function applyDocumentInsights(userId, key, insights, fileInfo) {
  if (!userId || !key || !insights) return null;
  const doc = await User.findById(userId, 'documentInsights').lean();
  const current = doc?.documentInsights || {};
  const sources = { ...(current.sources || {}) };
  const existing = sources[key] || {};
  sources[key] = {
    ...existing,
    key,
    metrics: insights.metrics || existing.metrics || {},
    narrative: insights.narrative || existing.narrative || [],
    transactions: insights.transactions || existing.transactions || [],
    files: mergeFileReference(existing.files, fileInfo),
  };

  const newState = {
    sources,
    aggregates: buildAggregates(sources),
    updatedAt: new Date(),
  };

  await User.findByIdAndUpdate(userId, {
    $set: {
      documentInsights: newState,
    },
  }).exec().catch((err) => {
    console.warn('[documents:insightsStore] failed to persist insights', err);
  });

  return newState;
}

module.exports = {
  applyDocumentInsights,
};
