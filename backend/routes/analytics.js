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
  const wealthPlan = user.wealthPlan || {};
  const summary = wealthPlan.summary || {};
  const assetAllocation = Array.isArray(summary.assetAllocation) ? summary.assetAllocation : [];
  const liabilitySchedule = Array.isArray(summary.liabilitySchedule) ? summary.liabilitySchedule : [];
  const affordability = summary.affordability || {};

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
  if (docAggregates.income?.gross != null) {
    metrics.push({
      key: 'income',
      value: Number(docAggregates.income.gross),
      format: 'currency',
      subLabel: (() => {
        const net = docAggregates.income.net;
        const pct = docAggregates.income.takeHomePercent;
        if (net != null && pct != null) {
          return `Take-home ${Number(net).toLocaleString('en-GB', { style: 'currency', currency: 'GBP' })} (${(pct * 100).toFixed(1)}% of gross).`;
        }
        if (net != null) {
          return `Net pay ${Number(net).toLocaleString('en-GB', { style: 'currency', currency: 'GBP' })}.`;
        }
        return 'Derived from latest payslip upload.';
      })(),
      sourceNote: 'Derived from payslip uploads in the document vault.',
    });
  }
  if (docAggregates.cashflow?.spend != null) {
    metrics.push({
      key: 'spend',
      value: Number(docAggregates.cashflow.spend),
      format: 'currency',
      delta: null,
      sourceNote: 'Calculated from categorised transactions in current account statements.'
    });
  }
  if (docAggregates.cashflow?.income != null) {
    metrics.push({
      key: 'savingsCapacity',
      value: Number(docAggregates.cashflow.income) - Number(docAggregates.cashflow.spend || 0),
      format: 'currency',
      subLabel: 'Income minus spending from documents',
      sourceNote: 'Income and spending inferred from bank statements.'
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

  const categorySource = Array.isArray(docAggregates.cashflow?.topCategories) && docAggregates.cashflow.topCategories.length
    ? docAggregates.cashflow.topCategories
    : Array.isArray(docAggregates.cashflow?.categories)
      ? docAggregates.cashflow.categories
      : [];
  const totalSpend = Number(docAggregates.cashflow?.spend || 0) || categorySource.reduce((acc, item) => acc + Number(item.outflow || item.amount || 0), 0) || 1;
  const spendCategories = categorySource
    .filter((cat) => (cat.outflow || cat.amount))
    .map((cat) => ({
      label: cat.category || cat.label || 'Category',
      amount: Number(cat.outflow ?? cat.amount ?? 0),
      share: totalSpend ? Number(cat.outflow ?? cat.amount ?? 0) / totalSpend : 0,
    }));

  const processingStates = Object.entries(docProcessing).map(([k, state]) => ({ key: k, ...(state || {}) }));
  const processingActive = processingStates.some((state) => state.active);
  const processingMessage = processingStates.find((state) => state.active && state.message)?.message
    || (processingActive ? 'Updating analytics…' : null);

  const payslipAnalytics = docAggregates.income && Object.keys(docAggregates.income).length
    ? {
        gross: docAggregates.income.gross ?? null,
        grossYtd: docAggregates.income.grossYtd ?? null,
        net: docAggregates.income.net ?? null,
        netYtd: docAggregates.income.netYtd ?? null,
        tax: docAggregates.income.tax ?? null,
        ni: docAggregates.income.ni ?? null,
        pension: docAggregates.income.pension ?? null,
        studentLoan: docAggregates.income.studentLoan ?? null,
        totalDeductions: docAggregates.income.totalDeductions ?? null,
        annualisedGross: docAggregates.income.annualisedGross ?? null,
        effectiveMarginalRate: docAggregates.income.effectiveMarginalRate ?? null,
        expectedMarginalRate: docAggregates.income.expectedMarginalRate ?? null,
        marginalRateDelta: docAggregates.income.marginalRateDelta ?? null,
        takeHomePercent: docAggregates.income.takeHomePercent ?? null,
        payFrequency: docAggregates.income.payFrequency || null,
        taxCode: docAggregates.income.taxCode || null,
        deductions: Array.isArray(docAggregates.income.deductions) ? docAggregates.income.deductions : [],
        earnings: Array.isArray(docAggregates.income.earnings) ? docAggregates.income.earnings : [],
        allowances: Array.isArray(docAggregates.income.allowances) ? docAggregates.income.allowances : [],
        notes: docAggregates.income.notes || [],
        extractionSource: docAggregates.income.extractionSource || null,
      }
    : null;

  const statementHighlights = docAggregates.cashflow && Object.keys(docAggregates.cashflow).length
    ? {
        totalIncome: docAggregates.cashflow.income ?? null,
        totalSpend: docAggregates.cashflow.spend ?? null,
        topCategories: Array.isArray(docAggregates.cashflow.topCategories) ? docAggregates.cashflow.topCategories : [],
        largestExpenses: Array.isArray(docAggregates.cashflow.largestExpenses) ? docAggregates.cashflow.largestExpenses : [],
      }
    : null;

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
      largestExpenses: Array.isArray(docAggregates.cashflow?.largestExpenses) ? docAggregates.cashflow.largestExpenses : [],
      payslipAnalytics,
      statementHighlights,
      hmrcBalance: docAggregates.tax?.taxDue != null ? { value: Number(docAggregates.tax.taxDue) } : null,
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
