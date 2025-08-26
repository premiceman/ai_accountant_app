// backend/src/services/tax/compute.service.js
const path = require('path');
const fs = require('fs');

function loadRules() {
  const p = path.join(__dirname, '../../config/tax/2025-26.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function effectivePersonalAllowance(rules, income) {
  const { personalAllowance, personalAllowanceTaperStart, personalAllowanceTaperRatePerPound } = rules;
  if (income <= personalAllowanceTaperStart) return personalAllowance;
  const reduction = (income - personalAllowanceTaperStart) * personalAllowanceTaperRatePerPound;
  return Math.max(0, personalAllowance - reduction);
}

function incomeTax(rules, taxable) {
  let remaining = Math.max(0, taxable);
  let tax = 0;
  let lastCap = 0;
  for (const band of rules.bands) {
    const cap = band.upTo ?? Infinity;       // null ⇒ no upper cap
    const span = Math.max(0, cap - lastCap); // width of this band
    const take = Math.min(remaining, span);
    if (take > 0) {
      tax += take * band.rate;
      remaining -= take;
    }
    lastCap = cap;
    if (remaining <= 0) break;
  }
  return tax;
}

function class1NI(rules, salary) {
  const c1 = rules.ni.class1;
  const PT = c1.primaryThreshold;
  const UEL = c1.upperEarningsLimit;
  if (salary <= PT) return 0;
  const main = Math.max(0, Math.min(salary, UEL) - PT) * c1.mainRate;
  const upper = Math.max(0, salary - UEL) * c1.upperRate;
  return main + upper;
}

function studentLoanDue(rules, plan, income) {
  if (!plan) return 0;
  const cfg = rules.studentLoan[plan];
  if (!cfg) return 0;
  const excess = Math.max(0, income - cfg.threshold);
  return excess * cfg.rate;
}

function computeTakeHome(input) {
  const rules = loadRules();
  const pensionPct = Number(input.pensionPct || 0);
  const plan = input.studentLoanPlan || null;

  // helper: compute net for a given salary (no recursion)
  const computeNet = (salary) => {
    const gross = Number(salary || 0);
    const pension = Math.max(0, gross * pensionPct / 100);
    const taxableBase = Math.max(0, gross - pension);
    const pa = effectivePersonalAllowance(rules, taxableBase);
    const taxableIncome = Math.max(0, taxableBase - pa);
    const tax = incomeTax(rules, taxableIncome);
    const ni = class1NI(rules, gross);
    const sl = studentLoanDue(rules, plan, gross);
    const other = 0;
    const net = gross - tax - ni - sl - pension - other;
    return { gross, net, tax, ni, sl, pension, pa, other };
  };

  const base = computeNet(input.salary);
  const waterfall = [
    { label: 'Gross', value: base.gross },
    { label: 'Income Tax', value: -base.tax },
    { label: 'NI', value: -base.ni },
    { label: 'Student Loan', value: -base.sl },
    { label: 'Pension', value: -base.pension },
    { label: 'Other', value: -base.other },
    { label: 'Net', value: base.net }
  ];

  // EMTR points (0..200k, £2k steps) using finite diff on +£100
  const emtrPoints = [];
  const step = 2000;
  for (let y = 0; y <= 200000; y += step) {
    const n1 = computeNet(y).net;
    const n2 = computeNet(y + 100).net;
    const deltaNet = n2 - n1;
    const emtr = 1 - (deltaNet / 100); // fraction of the next £1 lost to tax/NI/SL/pension
    emtrPoints.push({ income: y, emtr: Math.max(0, Math.min(1, emtr)) });
  }

  return {
    gross: base.gross,
    net: base.net,
    tax: base.tax,
    ni: base.ni,
    sl: base.sl,
    pension: base.pension,
    pa: base.pa,
    waterfall,
    emtrPoints
  };
}

module.exports = { computeTakeHome };
