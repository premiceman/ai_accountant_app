// backend/src/routes/income.routes.js
const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const IncomeProfile = require('../models/IncomeProfile');
const { computeTakeHome } = require('../services/tax/compute.service');

// GET /api/income/profile
router.get('/profile', auth, async (req, res) => {
  const doc = await IncomeProfile.findOne({ userId: req.user.id });
  res.json(doc || { userId: req.user.id, region: 'EnglandWales', salary: 0, pensionPct: 0, studentLoanPlan: null, taxCode: '' });
});

// PUT /api/income/profile
router.put('/profile', auth, express.json(), async (req, res) => {
  const payload = {
    region: req.body.region || 'EnglandWales',
    salary: Number(req.body.salary || 0),
    pensionPct: Number(req.body.pensionPct || 0),
    studentLoanPlan: req.body.studentLoanPlan || null,
    taxCode: (req.body.taxCode || '').trim()
  };
  const doc = await IncomeProfile.findOneAndUpdate(
    { userId: req.user.id },
    { $set: payload },
    { upsert: true, new: true }
  );
  res.json(doc);
});

// POST /api/income/what-if
router.post('/what-if', auth, express.json(), async (req, res) => {
  const input = {
    salary: Number(req.body.salary || 0),
    pensionPct: Number(req.body.pensionPct || 0),
    studentLoanPlan: req.body.studentLoanPlan || null
  };
  const result = computeTakeHome(input);
  res.json({ input, result });
});

module.exports = router;
