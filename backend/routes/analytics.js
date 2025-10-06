// backend/routes/analytics.js
const express = require('express');
const dayjs = require('dayjs');
const auth = require('../middleware/auth');
const User = require('../models/User');
const { paths, readJsonSafe } = require('../src/store/jsondb');

const router = express.Router();

// TODO(analytics-cache): Swap range parsing + payload assembly to read from AnalyticsCache
// and trigger background recompute via /_internal/analytics/recompute (see docs/compatibility-map.md).

const REQUIRED_DOC_TYPES = [
  { type: 'p60', label: 'P60' },
  { type: 'p45', label: 'P45 / starter checklist' },
  { type: 'bank_statement', label: 'Bank statements' },
  { type: 'id', label: 'Photo ID' },
  { type: 'utr', label: 'UTR or HMRC letter' }
];

const money = (n) => Number(n || 0);

function parseRange(query) {
  const preset = String(query.preset || '').toLowerCase();
  const start = query.start ? dayjs(query.start) : null;
  const end = query.end ? dayjs(query.end) : null;

  const now = dayjs();
  if (start && end && start.isValid() && end.isValid()) {
    return {
      mode: 'custom',
      start: start.startOf('day').toDate(),
      end: end.endOf('day').toDate(),
      label: `${start.format('D MMM YYYY')} – ${end.format('D MMM YYYY')}`
    };
  }

  switch (preset) {
    case 'last-year':
      return {
        mode: 'preset',
        preset: 'last-year',
        start: now.subtract(1, 'year').startOf('year').toDate(),
        end: now.subtract(1, 'year').endOf('year').toDate(),
        label: 'Last tax year'
      };
    case 'last-quarter':
      return {
        mode: 'preset',
        preset: 'last-quarter',
        start: now.subtract(1, 'quarter').startOf('quarter').toDate(),
        end: now.subtract(1, 'quarter').endOf('quarter').toDate(),
        label: 'Last quarter'
      };
    case 'year-to-date':
      return {
        mode: 'preset',
        preset: 'year-to-date',
        start: now.startOf('year').toDate(),
        end: now.toDate(),
        label: 'Year to date'
      };
    default:
      return {
        mode: 'preset',
        preset: 'last-month',
        start: now.subtract(1, 'month').startOf('month').toDate(),
        end: now.subtract(1, 'month').endOf('month').toDate(),
        label: 'Last month'
      };
  }
}

function daysBetween(a, b) {
  return Math.max(1, Math.round((b - a) / (1000 * 60 * 60 * 24)));
}

function prevComparableRange(range) {
  const durationMs = Math.max(1, range.end.getTime() - range.start.getTime());
  const prevEnd = new Date(range.start.getTime());
  const prevStart = new Date(prevEnd.getTime() - durationMs);
  return { start: prevStart, end: prevEnd };
}

// TODO(analytics-cache): Retire ad-hoc usage stats once DocChecklist + AnalyticsCache models land.
async function computeUsageStats(userId, range) {
  try {
    const [txAll, docsIndex, accounts] = await Promise.all([
      readJsonSafe(paths.transactions, { transactions: [] }),
      readJsonSafe(paths.docsIndex, []),
      readJsonSafe(paths.accounts, { accounts: [] })
    ]);

    const transactions = Array.isArray(txAll.transactions) ? txAll.transactions : [];
    const prev = prevComparableRange(range);

    const withinRange = transactions.filter((t) => {
      const when = new Date(t.date);
      return when >= range.start && when < range.end;
    });
    const withinPrev = transactions.filter((t) => {
      const when = new Date(t.date);
      return when >= prev.start && when < prev.end;
    });

    const sumIncome = (list) =>
      list.reduce((acc, t) => acc + (money(t.amount) > 0 ? money(t.amount) : 0), 0);
    const sumSpend = (list) =>
      list.reduce((acc, t) => acc + (money(t.amount) < 0 ? Math.abs(money(t.amount)) : 0), 0);

    const incomeCurrent = sumIncome(withinRange);
    const spendCurrent = sumSpend(withinRange);
    const incomePrev = sumIncome(withinPrev);
    const spendPrev = sumSpend(withinPrev);

    const netCurrent = incomeCurrent - spendCurrent;
    const netPrev = incomePrev - spendPrev;

    const moneySavedEstimate = Math.max(0, spendPrev - spendCurrent);
    const moneySavedChangePct =
      spendPrev > 0 ? ((spendPrev - spendCurrent) / spendPrev) * 100 : null;

    const debtAccounts = (accounts.accounts || []).filter((a) =>
      ['loan', 'credit'].includes(String(a.type))
    );
    const debtOutstanding = debtAccounts.reduce(
      (acc, a) => acc + Math.max(0, money(a.balance)),
      0
    );
    const debtReduced = Math.min(debtOutstanding, Math.max(0, netCurrent));
    const debtReductionDelta = Math.round(debtReduced - Math.max(0, netPrev));

    const docs = Array.isArray(docsIndex) ? docsIndex : [];
    const userDocs = docs.filter((doc) => String(doc.userId) === String(userId));
    const haveTypes = new Set(
      userDocs
        .map((doc) => String(doc.type || '').toLowerCase())
        .filter((type) => type.length)
    );
    const totalRequired = REQUIRED_DOC_TYPES.length;
    const completedRequired = REQUIRED_DOC_TYPES.filter((doc) =>
      haveTypes.has(doc.type)
    ).length;
    const documentsProgress = totalRequired
      ? Math.min(100, Math.round((completedRequired / totalRequired) * 100))
      : 0;

    return {
      documentsUploaded: userDocs.length,
      documentsRequiredMet: documentsProgress,
      documentsRequiredCompleted: completedRequired,
      documentsRequiredTotal: totalRequired,
      documentsOutstanding: Math.max(0, totalRequired - completedRequired),
      moneySavedEstimate: Math.round(moneySavedEstimate),
      moneySavedPrevSpend: Math.round(spendPrev),
      moneySavedChangePct:
        moneySavedChangePct == null ? null : Math.round(moneySavedChangePct),
      debtOutstanding: Math.round(debtOutstanding),
      debtReduced: Math.round(debtReduced),
      debtReductionDelta,
      netCashFlow: Math.round(netCurrent),
      netCashPrev: Math.round(netPrev),
      usageWindowDays: daysBetween(range.start, range.end),
      updatedAt: new Date()
    };
  } catch (err) {
    console.warn('Failed to compute usage stats', err);
    return null;
  }
}

function toDate(value) {
  if (!value) return null;
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return direct;
  const match = String(value).match(/(\d{4}-\d{2}-\d{2})/);
  if (match) {
    const iso = `${match[1]}T00:00:00Z`;
    const coerced = new Date(iso);
    return Number.isNaN(coerced.getTime()) ? null : coerced;
  }
  return null;
}

function withinRange(value, range) {
  const date = toDate(value);
  if (!date) return false;
  return date >= range.start && date <= range.end;
}

function monthRangeFromKey(monthKey) {
  if (!monthKey) return null;
  const parts = String(monthKey).split('-');
  if (parts.length !== 2) return null;
  const year = Number(parts[0]);
  const monthIndex = Number(parts[1]) - 1;
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex)) return null;
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999));
  return { start, end };
}

function timelineEntryWithinRange(entry, range) {
  if (!entry?.period) return false;
  let start = toDate(entry.period.start);
  let end = toDate(entry.period.end);
  if (!start || !end) {
    const monthRange = monthRangeFromKey(entry.period.month);
    if (monthRange) {
      start = start || monthRange.start;
      end = end || monthRange.end;
    }
  }
  if (!start || !end) return false;
  return start <= range.end && end >= range.start;
}

function groupSourcesByBase(sources = {}) {
  const grouped = {};
  for (const entry of Object.values(sources)) {
    if (!entry) continue;
    const baseKey = entry.baseKey || entry.key;
    if (!baseKey) continue;
    if (!grouped[baseKey]) grouped[baseKey] = [];
    grouped[baseKey].push(entry);
  }
  return grouped;
}

function summariseStatementRange(entries = [], range) {
  const accounts = new Map();
  const transactions = [];
  entries.forEach((entry) => {
    const meta = entry.metadata || {};
    const accountId = meta.accountId || entry.key;
    const accountName = meta.accountName || 'Account';
    const accountSummary = accounts.get(accountId) || {
      accountId,
      accountName,
      bankName: meta.bankName || null,
      accountType: meta.accountType || null,
      accountNumberMasked: meta.accountNumberMasked || null,
      period: meta.period || entry.period || null,
      totals: { income: 0, spend: 0 },
    };
    accounts.set(accountId, accountSummary);

    const txList = Array.isArray(entry.transactions) ? entry.transactions : [];
    const fallbackDate = meta.period?.end || meta.period?.start || entry.period || (entry.files?.[0]?.uploadedAt || null);
    txList.forEach((tx, idx) => {
      const txDate = tx.date || fallbackDate;
      if (!withinRange(txDate, range)) return;
      const amount = Number(tx.amount);
      if (!Number.isFinite(amount)) return;
      const id = `${entry.key}:${idx}`;
      transactions.push({
        __id: id,
        amount,
        direction: tx.direction || (amount >= 0 ? 'inflow' : 'outflow'),
        description: tx.description || 'Transaction',
        category: tx.category || 'Other',
        date: tx.date || null,
        transfer: Boolean(tx.transfer),
        accountId,
        accountName,
      });
    });
  });

  if (!transactions.length) {
    return {
      totals: { income: 0, spend: 0 },
      categories: [],
      topCategories: [],
      largestExpenses: [],
      accounts: Array.from(accounts.values()).map((acc) => ({ ...acc, totals: { income: 0, spend: 0 } })),
      transactions: [],
      transferCount: 0,
      hasData: false,
    };
  }

  const signatureMap = new Map();
  const transferIds = new Set();
  transactions.forEach((tx) => {
    if (tx.transfer) transferIds.add(tx.__id);
    const dateKey = tx.date ? String(tx.date).slice(0, 10) : 'unknown';
    const descKey = String(tx.description || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const key = `${dateKey}|${Math.abs(tx.amount).toFixed(2)}|${descKey}`;
    const bucket = signatureMap.get(key) || { inflow: [], outflow: [] };
    if (tx.amount >= 0) bucket.inflow.push(tx);
    else bucket.outflow.push(tx);
    signatureMap.set(key, bucket);
  });

  for (const bucket of signatureMap.values()) {
    if (bucket.inflow.length && bucket.outflow.length) {
      bucket.inflow.forEach((tx) => transferIds.add(tx.__id));
      bucket.outflow.forEach((tx) => transferIds.add(tx.__id));
    }
  }

  const filtered = transactions.filter((tx) => !transferIds.has(tx.__id));

  filtered.forEach((tx) => {
    const acc = accounts.get(tx.accountId);
    if (!acc) return;
    if (tx.amount >= 0) acc.totals.income += tx.amount;
    else acc.totals.spend += Math.abs(tx.amount);
  });

  const totals = filtered.reduce((acc, tx) => {
    if (tx.amount >= 0) acc.income += tx.amount;
    else acc.spend += Math.abs(tx.amount);
    return acc;
  }, { income: 0, spend: 0 });

  const categoryGroups = {};
  filtered.forEach((tx) => {
    const key = tx.category || 'Other';
    if (!categoryGroups[key]) categoryGroups[key] = { category: key, inflow: 0, outflow: 0 };
    if (tx.amount >= 0) categoryGroups[key].inflow += tx.amount;
    else categoryGroups[key].outflow += Math.abs(tx.amount);
  });

  const categories = Object.values(categoryGroups)
    .sort((a, b) => (b.outflow || b.inflow) - (a.outflow || a.inflow));
  const totalOutflow = categories.reduce((acc, item) => acc + (item.outflow || 0), 0);
  const spendingCanteorgies = categories
    .filter((item) => item.outflow || item.inflow)
    .map((item) => ({
      label: item.category,
      category: item.category,
      amount: item.outflow || item.inflow || 0,
      outflow: item.outflow || 0,
      inflow: item.inflow || 0,
      share: totalOutflow ? (item.outflow || 0) / totalOutflow : 0,
    }));
  const topCategories = categories
    .filter((cat) => cat.outflow)
    .slice(0, 5)
    .map((cat) => ({
      category: cat.category,
      outflow: cat.outflow,
      inflow: cat.inflow,
    }));

  const largestExpenses = filtered
    .filter((tx) => tx.amount < 0)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, 5)
    .map((tx) => ({
      description: tx.description,
      amount: Math.abs(tx.amount),
      category: tx.category,
      date: tx.date || null,
      accountName: tx.accountName || null,
    }));

  return {
    totals,
    categories,
    topCategories,
    largestExpenses,
    accounts: Array.from(accounts.values()).map((acc) => ({
      ...acc,
      totals: {
        income: Math.round(acc.totals.income * 100) / 100,
        spend: Math.round(acc.totals.spend * 100) / 100,
      },
    })),
    transactions: filtered,
    transferCount: transferIds.size,
    hasData: filtered.length > 0,
    spendingCanteorgies,
  };
}

function buildRangeView(docSources = {}, range) {
  const grouped = groupSourcesByBase(docSources);

  const payslipEntries = Array.isArray(grouped.payslip) ? grouped.payslip : [];
  const payslipInRange = payslipEntries
    .map((entry) => ({
      entry,
      payDate: entry.metrics?.payDate
        || entry.metadata?.payDate
        || entry.metrics?.periodEnd
        || entry.metrics?.periodStart
        || entry.files?.[0]?.uploadedAt,
    }))
    .filter((item) => withinRange(item.payDate, range));
  const latestPayslip = payslipInRange
    .slice()
    .sort((a, b) => {
      const aDate = toDate(a.payDate);
      const bDate = toDate(b.payDate);
      return (bDate?.getTime() || 0) - (aDate?.getTime() || 0);
    })[0]?.entry || null;

  const statementEntries = Array.isArray(grouped.current_account_statement)
    ? grouped.current_account_statement
    : [];
  const statementSummary = summariseStatementRange(statementEntries, range);

  return {
    payslip: {
      latest: latestPayslip,
      entries: payslipInRange.map((item) => item.entry),
      hasData: payslipInRange.length > 0,
    },
    statements: statementSummary,
  };
}

// GET /api/analytics/dashboard
router.get('/dashboard', auth, async (req, res) => {
  const user = await User.findById(req.user.id).lean();
  if (!user) return res.status(404).json({ error: 'User not found' });

  const range = parseRange(req.query);
  const docInsights = user.documentInsights || {};
  const docSources = docInsights.sources || {};
  const docAggregates = docInsights.aggregates || {};
  const docProcessing = docInsights.processing || {};
  const hasData = Object.keys(docSources).length > 0;
  const timelineRaw = Array.isArray(docInsights.timeline) ? docInsights.timeline : [];
  const timelineInRange = timelineRaw.filter((entry) => timelineEntryWithinRange(entry, range));
  const wealthPlan = user.wealthPlan || {};
  const summary = wealthPlan.summary || {};
  const assetAllocation = Array.isArray(summary.assetAllocation) ? summary.assetAllocation : [];
  const liabilitySchedule = Array.isArray(summary.liabilitySchedule) ? summary.liabilitySchedule : [];
  const affordability = summary.affordability || {};
  const rangeView = buildRangeView(docSources, range);
  const latestPayslipEntry = rangeView.payslip.latest;
  const statementSummary = rangeView.statements;

  const assetBreakdown = assetAllocation.map((item) => ({
    key: item.key || item.label,
    label: item.label || item.key,
    value: Number(item.total || 0),
    weight: item.weight || 0,
    type: 'asset'
  }));

  const liabilityBreakdown = liabilitySchedule.map((item) => ({
    key: item.id || item.name,
    label: item.name || 'Liability',
    value: Number(item.startingBalance || 0),
    monthlyPayment: Number(item.monthlyPayment || 0),
    payoffMonths: item.payoffMonths || null,
    type: 'liability'
  }));

  const metrics = [];
  if (latestPayslipEntry?.metrics?.gross != null) {
    const payMetrics = latestPayslipEntry.metrics;
    metrics.push({
      key: 'income',
      value: Number(payMetrics.gross),
      format: 'currency',
      subLabel: (() => {
        const net = payMetrics.net;
        const pct = payMetrics.takeHomePercent;
        if (net != null && pct != null) {
          return `Take-home ${Number(net).toLocaleString('en-GB', { style: 'currency', currency: 'GBP' })} (${(pct * 100).toFixed(1)}% of gross).`;
        }
        if (net != null) {
          return `Net pay ${Number(net).toLocaleString('en-GB', { style: 'currency', currency: 'GBP' })}.`;
        }
        return 'Derived from latest payslip in range.';
      })(),
      sourceNote: 'Derived from payslip uploads within the selected range.',
    });
  }
  if (statementSummary?.hasData) {
    metrics.push({
      key: 'spend',
      value: Number(statementSummary.totals.spend || 0),
      format: 'currency',
      delta: null,
      sourceNote: 'Calculated from categorised transactions in current account statements (range filtered).'
    });
    metrics.push({
      key: 'savingsCapacity',
      value: Number(statementSummary.totals.income || 0) - Number(statementSummary.totals.spend || 0),
      format: 'currency',
      subLabel: 'Income minus spending from documents in range',
      sourceNote: 'Income and spending inferred from bank statements (range filtered).'
    });
  }
  if (docAggregates.tax?.taxDue != null) {
    metrics.push({
      key: 'hmrcBalance',
      value: Number(docAggregates.tax.taxDue),
      format: 'currency',
      subLabel: 'Outstanding balance from HMRC correspondence',
      sourceNote: 'Based on latest HMRC correspondence upload.'
    });
  }

  const categorySourceRaw = Array.isArray(statementSummary?.spendingCanteorgies)
    ? statementSummary.spendingCanteorgies
    : Array.isArray(statementSummary?.categories)
      ? statementSummary.categories
      : [];
  const totalSpendRaw = categorySourceRaw.reduce((acc, item) => acc + Number(item.outflow ?? item.amount ?? 0), 0);
  const spendDivisor = totalSpendRaw || Number(statementSummary?.totals?.spend || 0);
  const spendCategories = categorySourceRaw
    .filter((cat) => (cat.outflow || cat.amount))
    .map((cat) => ({
      label: cat.label || cat.category || 'Category',
      amount: Number(cat.outflow ?? cat.amount ?? 0),
      share: spendDivisor ? Number(cat.outflow ?? cat.amount ?? 0) / spendDivisor : 0,
    }));

  const processingStates = Object.entries(docProcessing).map(([k, state]) => ({ key: k, ...(state || {}) }));
  const processingActive = processingStates.some((state) => state.active);
  const processingMessage = processingStates.find((state) => state.active && state.message)?.message
    || (processingActive ? 'Updating analytics…' : null);

  const payslipAnalytics = latestPayslipEntry?.metrics
    ? {
        gross: latestPayslipEntry.metrics.gross ?? null,
        grossYtd: latestPayslipEntry.metrics.grossYtd ?? null,
        net: latestPayslipEntry.metrics.net ?? null,
        netYtd: latestPayslipEntry.metrics.netYtd ?? null,
        tax: latestPayslipEntry.metrics.tax ?? null,
        ni: latestPayslipEntry.metrics.ni ?? null,
        pension: latestPayslipEntry.metrics.pension ?? null,
        studentLoan: latestPayslipEntry.metrics.studentLoan ?? null,
        totalDeductions: latestPayslipEntry.metrics.totalDeductions ?? null,
        annualisedGross: latestPayslipEntry.metrics.annualisedGross ?? null,
        effectiveMarginalRate: latestPayslipEntry.metrics.effectiveMarginalRate ?? null,
        expectedMarginalRate: latestPayslipEntry.metrics.expectedMarginalRate ?? null,
        marginalRateDelta: latestPayslipEntry.metrics.marginalRateDelta ?? null,
        takeHomePercent: latestPayslipEntry.metrics.takeHomePercent ?? null,
        payFrequency: latestPayslipEntry.metrics.payFrequency || null,
        taxCode: latestPayslipEntry.metrics.taxCode || null,
        deductions: Array.isArray(latestPayslipEntry.metrics.deductions) ? latestPayslipEntry.metrics.deductions : [],
        earnings: Array.isArray(latestPayslipEntry.metrics.earnings) ? latestPayslipEntry.metrics.earnings : [],
        allowances: Array.isArray(latestPayslipEntry.metrics.allowances) ? latestPayslipEntry.metrics.allowances : [],
        notes: latestPayslipEntry.metrics.notes || [],
        extractionSource: latestPayslipEntry.metrics.extractionSource || null,
        payDate: latestPayslipEntry.metrics.payDate || latestPayslipEntry.metadata?.payDate || null,
        periodStart: latestPayslipEntry.metrics.periodStart || latestPayslipEntry.metadata?.periodStart || null,
        periodEnd: latestPayslipEntry.metrics.periodEnd || latestPayslipEntry.metadata?.periodEnd || null,
      }
    : null;

  const statementHighlights = statementSummary?.hasData
    ? {
        totalIncome: statementSummary.totals.income ?? null,
        totalSpend: statementSummary.totals.spend ?? null,
        topCategories: Array.isArray(statementSummary.topCategories) ? statementSummary.topCategories : [],
        largestExpenses: Array.isArray(statementSummary.largestExpenses) ? statementSummary.largestExpenses : [],
        accounts: Array.isArray(statementSummary.accounts) ? statementSummary.accounts : [],
        transferCount: statementSummary.transferCount || 0,
        spendingCanteorgies: Array.isArray(statementSummary.spendingCanteorgies)
          ? statementSummary.spendingCanteorgies
          : [],
      }
    : null;

  const rangeStatus = {
    payslip: rangeView.payslip.hasData ? null : 'No payslip data in selected range.',
    statements: statementSummary?.hasData ? null : 'No statements in selected range.',
  };

  const usage = user.usageStats || {};
  const documentsProgress = {
    required: {
      completed: usage.documentsRequiredMet || 0,
      total: usage.documentsRequiredTotal || REQUIRED_DOC_TYPES.length,
    },
    helpful: {
      completed: usage.documentsHelpfulMet || 0,
      total: usage.documentsHelpfulTotal || 0,
    },
    analytics: {
      completed: usage.documentsAnalyticsMet || 0,
      total: usage.documentsAnalyticsTotal || 0,
    },
    updatedAt: usage.documentsProgressUpdatedAt || null,
  };
  const progressPercent = documentsProgress.required.total
    ? Math.round((documentsProgress.required.completed / documentsProgress.required.total) * 100)
    : 0;

  const usageStatsNew = await computeUsageStats(user._id, range);
  if (usageStatsNew) {
    const prevUsage = user.usageStats || {};
    const prevSaved = Number(prevUsage.moneySavedEstimate || 0);
    const newSaved = Number(usageStatsNew.moneySavedEstimate || 0);
    let cumulative = Number(prevUsage.moneySavedCumulative || 0);
    if (newSaved > prevSaved) cumulative += newSaved - prevSaved;
    usageStatsNew.moneySavedCumulative = Math.round(cumulative);
    const nextUsage = { ...prevUsage, ...usageStatsNew };
    await User.findByIdAndUpdate(user._id, { $set: { usageStats: nextUsage } }).exec().catch(() => {});
    user.usageStats = nextUsage;
  }

  const payload = {
    range,
    preferences: user.preferences || {},
    hasData,
    accounting: {
      metrics,
      allowances: [],
      obligations: [],
      processing: {
        active: processingActive,
        message: processingMessage,
        states: processingStates,
      },
      documents: {
        required: [],
        helpful: [],
        analytics: [],
        progress: documentsProgress,
        progressPercent,
      },
      comparatives: {
        mode: (user.preferences?.deltaMode || 'absolute'),
        values: []
      },
      spendByCategory: spendCategories,
      spendingCanteorgies: spendCategories,
      timeline: timelineInRange,
      largestExpenses: Array.isArray(statementSummary?.largestExpenses) ? statementSummary.largestExpenses : [],
      payslipAnalytics,
      statementHighlights,
      hmrcBalance: docAggregates.tax?.taxDue != null ? { value: Number(docAggregates.tax.taxDue) } : null,
      rangeStatus,
    },
    financialPosture: {
      netWorth: summary.netWorth ?? null,
      breakdown: [...assetBreakdown, ...liabilityBreakdown],
      liquidity: summary.cashReserves != null ? {
        cash: Number(summary.cashReserves || 0),
        runwayMonths: summary.runwayMonths ?? null
      } : null,
      trends: summary.projections?.yearly || [],
      savingsRate: affordability.savingsRateCurrent ?? null,
      affordability: {
        freeCashflow: affordability.freeCashflow ?? null,
        recommendedContribution: affordability.recommendedContribution ?? null,
        recommendedSavingsRate: affordability.recommendedSavingsRate ?? null,
        advisories: Array.isArray(affordability.advisories) ? affordability.advisories : []
      }
    },
    salaryNavigator: user.salaryNavigator || {},
    wealthPlan,
    aiInsights: [],
    gating: {
      tier: user.licenseTier || 'free'
    }
  };

  const advisories = Array.isArray(affordability.advisories) ? affordability.advisories.filter(Boolean) : [];
  if (advisories.length) {
    payload.aiInsights.push({
      id: `affordability-${Date.now()}`,
      type: 'affordability',
      title: 'Affordability advisory',
      body: advisories.join(' '),
      createdAt: new Date()
    });
  }

  res.json(payload);
});

module.exports = router;
