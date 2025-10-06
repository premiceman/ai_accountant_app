// backend/routes/analytics.js
const express = require('express');
const dayjs = require('dayjs');
const auth = require('../middleware/auth');
const User = require('../models/User');

const router = express.Router();

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

// GET /api/analytics/dashboard
router.get('/dashboard', auth, async (req, res) => {
  const user = await User.findById(req.user.id).lean();
  if (!user) return res.status(404).json({ error: 'User not found' });

  const range = parseRange(req.query);
  const integrations = Array.isArray(user.integrations) ? user.integrations : [];
  const hasData = integrations.some((i) => i.status === 'connected');
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
        progress: user.usageStats?.documentsRequiredMet || 0
      },
      comparatives: {
        mode: (user.preferences?.deltaMode || 'absolute'),
        values: []
      }
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
