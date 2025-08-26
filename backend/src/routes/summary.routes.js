// backend/src/routes/summary.routes.js
const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const IncomeProfile = require('../models/IncomeProfile');
const { computeTakeHome } = require('../services/tax/compute.service');

// GET /api/summary/current-year
router.get('/current-year', auth, async (req, res) => {
  const prof = await IncomeProfile.findOne({ userId: req.user.id });
  const base = prof ? {
    salary: prof.salary,
    pensionPct: prof.pensionPct,
    studentLoanPlan: prof.studentLoanPlan
  } : { salary: 0, pensionPct: 0, studentLoanPlan: null };

  const calc = computeTakeHome(base);

  const gauges = [
    { key: 'personalAllowance', used: Math.min(calc.pa, calc.pa), total: calc.pa },
    { key: 'dividendAllowance', used: 0, total: 500 },
    { key: 'cgtAllowance', used: 0, total: 3000 },
    { key: 'pensionAnnual', used: (base.salary * base.pensionPct)/100, total: 60000 },
    { key: 'isa', used: 0, total: 20000 }
  ];

  res.json({
    year: '2025-26',
    summary: {
      gross: calc.gross,
      net: calc.net,
      tax: calc.tax,
      ni: calc.ni,
      studentLoan: calc.sl,
      pension: calc.pension
    },
    waterfall: calc.waterfall,
    emtr: calc.emtrPoints,
    gauges,
    events: []
  });
});

module.exports = router;

