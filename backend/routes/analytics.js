// backend/routes/analytics.js
const express = require('express');
const dayjs = require('dayjs');
const auth = require('../middleware/auth');
const User = require('../models/User');
const { paths, readJsonSafe } = require('../src/store/jsondb');

const router = express.Router();

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
  const integrations = Array.isArray(user.integrations) ? user.integrations : [];
  const hasData = integrations.some((i) => i.status === 'connected');
  const usageStats = await computeUsageStats(user._id, range);
  if (usageStats) {
    const nextUsage = { ...user.usageStats, ...usageStats };
    try {
      await User.updateOne({ _id: user._id }, { $set: { usageStats: nextUsage } });
    } catch (err) {
      console.warn('Failed to persist usage stats', err);
    }
    user.usageStats = nextUsage;
  }
  const payload = {
    range,
    preferences: user.preferences || {},
    hasData,
    accounting: {
      metrics: [],
      allowances: [],
      obligations: [],
      documents: {
        required: [],
        helpful: [],
        progress: user.usageStats?.documentsRequiredMet || 0,
        completed: {
          count: user.usageStats?.documentsRequiredCompleted || 0,
          total: user.usageStats?.documentsRequiredTotal || REQUIRED_DOC_TYPES.length
        }
      },
      comparatives: {
        mode: (user.preferences?.deltaMode || 'absolute'),
        values: []
      }
    },
    financialPosture: {
      netWorth: null,
      breakdown: [],
      liquidity: null,
      trends: [],
      savingsRate: null
    },
    salaryNavigator: user.salaryNavigator || {},
    wealthPlan: user.wealthPlan || {},
    aiInsights: [],
    gating: {
      tier: user.licenseTier || 'free'
    }
  };

  if (user.usageStats) {
    payload.usageStats = user.usageStats;
  }

  res.json(payload);
});

module.exports = router;
