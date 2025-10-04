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

  res.json(payload);
});

module.exports = router;
