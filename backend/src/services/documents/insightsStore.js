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
      grossYtd: payslip.metrics.grossYtd ?? null,
      net: payslip.metrics.net ?? null,
      netYtd: payslip.metrics.netYtd ?? null,
      tax: payslip.metrics.tax ?? null,
      ni: payslip.metrics.ni ?? null,
      pension: payslip.metrics.pension ?? null,
      studentLoan: payslip.metrics.studentLoan ?? null,
      totalDeductions: payslip.metrics.totalDeductions ?? null,
      annualisedGross: payslip.metrics.annualisedGross ?? null,
      effectiveMarginalRate: payslip.metrics.effectiveMarginalRate ?? null,
      expectedMarginalRate: payslip.metrics.expectedMarginalRate ?? null,
      marginalRateDelta: payslip.metrics.marginalRateDelta ?? null,
      takeHomePercent: payslip.metrics.takeHomePercent ?? null,
      payFrequency: payslip.metrics.payFrequency || null,
      taxCode: payslip.metrics.taxCode || null,
      deductions: Array.isArray(payslip.metrics.deductions) ? payslip.metrics.deductions : [],
      earnings: Array.isArray(payslip.metrics.earnings) ? payslip.metrics.earnings : [],
      allowances: Array.isArray(payslip.metrics.allowances) ? payslip.metrics.allowances : [],
      extractionSource: payslip.metrics.extractionSource || null,
    };
    if (payslip.metrics.notes) {
      aggregates.income.notes = payslip.metrics.notes;
    }
  }

  const currentAccount = sources.current_account_statement;
  if (currentAccount?.metrics) {
    aggregates.cashflow = {
      income: currentAccount.metrics.income ?? 0,
      spend: currentAccount.metrics.spend ?? 0,
      categories: currentAccount.metrics.categories || [],
      topCategories: currentAccount.metrics.topCategories || [],
      largestExpenses: currentAccount.metrics.largestExpenses || [],
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

  const hmrcMetrics = sources.hmrc_correspondence?.metrics || {};
  if (hmrcMetrics.taxDue != null) {
    aggregates.tax = {
      taxDue: hmrcMetrics.taxDue,
    };
  }
  if ((aggregates.tax?.taxDue == null) && aggregates.income?.tax != null) {
    aggregates.tax = {
      ...aggregates.tax,
      taxDue: aggregates.income.tax,
    };
  }
  if (aggregates.income?.effectiveMarginalRate != null) {
    aggregates.tax = {
      ...aggregates.tax,
      effectiveMarginalRate: aggregates.income.effectiveMarginalRate,
      expectedMarginalRate: aggregates.income.expectedMarginalRate ?? null,
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
    files: fileInfo ? mergeFileReference(existing.files, fileInfo) : (existing.files || []),
  };

  const processing = { ...(current.processing || {}) };
  processing[key] = {
    ...(processing[key] || {}),
    active: false,
    message: fileInfo?.name ? `Updated from ${fileInfo.name}` : 'Analytics refreshed',
    updatedAt: new Date(),
  };

  const newState = {
    sources,
    aggregates: buildAggregates(sources),
    processing,
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

async function setInsightsProcessing(userId, key, state) {
  if (!userId || !key) return null;
  const path = `documentInsights.processing.${key}`;
  try {
    if (!state) {
      await User.findByIdAndUpdate(userId, { $unset: { [path]: '' } }).exec();
      return null;
    }
    const payload = {
      active: Boolean(state.active),
      message: state.message || null,
      updatedAt: new Date(),
    };
    if (state.step) payload.step = state.step;
    if (state.progress != null) payload.progress = state.progress;
    await User.findByIdAndUpdate(userId, { $set: { [path]: payload } }).exec();
    return payload;
  } catch (err) {
    console.warn('[documents:insightsStore] failed to set processing state', err);
    return null;
  }
}

module.exports = {
  applyDocumentInsights,
  setInsightsProcessing,
};
