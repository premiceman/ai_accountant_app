// backend/src/routes/summary.routes.js
const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');

// NOTE: UI-first stub. Returns a stable contract the frontend can render.
// We'll swap in real tax compute next (services/tax + config/tax JSON).
router.get('/current-year', auth, async (req, res) => {
  try {
    // Minimal placeholder; front-end will render gracefully.
    const summary = {
      year: '2025/26',
      currency: 'GBP',
      // Waterfall amounts in pounds (positive gross/net, negative deductions)
      waterfall: [
        { label: 'Gross Income', amount: 0 },
        { label: 'Income Tax', amount: 0 },
        { label: 'National Insurance', amount: 0 },
        { label: 'Student Loan', amount: 0 },
        { label: 'Pension', amount: 0 },
        { label: 'Net Pay', amount: 0 }
      ],
      // EMTR points: income (x), marginalRate (0–1)
      emtr: [
        { income: 0, rate: 0.0 },
        { income: 10000, rate: 0.2 }
      ],
      // Gauges: used, total (numbers in pounds where relevant)
      gauges: {
        personalAllowance: { used: 0, total: 12570 },
        dividendAllowance: { used: 0, total: 500 },
        cgtAllowance:      { used: 0, total: 3000 },
        pensionAnnual:     { used: 0, total: 60000 },
        isa:               { used: 0, total: 20000 }
      },
      // Upcoming events timeline tiles
      events: [
        // Example format; leave empty until we add tasks & real events
        // { date: '2026-01-31', title: 'Self Assessment payment due', kind: 'deadline' }
      ]
    };

    res.json(summary);
  } catch (e) {
    console.error('GET /api/summary/current-year error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
