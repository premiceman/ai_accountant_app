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
  const excess = income - personalAllowanceTaperStart;
  const reduction = excess * personalAllowanceTaperRatePerPound;
  return Math.max(0, personalAllowance - reduction);
}

function incomeTax(rules, taxable) {
  let remaining = Math.max(0, taxable);
  let tax = 0;
  for (const band of rules.bands) {
    const rate = band.rate;
    const cap = band.upTo;
    if (cap == null) {
      tax += remaining * rate;
      remaining = 0;
      break;
    }
    const bandWidth = Math.max(0, cap - (rules.bands[0].upTo - (band.name === 'basic' ? rules.bands[0].upTo : 0)));
    // Simplified: treat bands as absolute thresholds
    const prevCap = (band.name === 'basic') ? 0 : rules.bands.find(b => b.upTo === bandWidth)?.upTo || 50270;
    const span = cap - prevCap;
    const take = Math.min(remaining, span);
    tax += Math.max(0, take) * rate;
    remaining -= take;
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
  const r = rules.studentLoan[plan];
  if (!r) return 0;
  const excess = Math.max(0, income - r.threshold);
  return excess * r.rate;
}

function computeTakeHome(input) {
  const rules = loadRules();
  const gross = Number(input.salary || 0);
  const pensionPct = Number(input.pensionPct || 0);
  const pension = Math.max(0, gross * pensionPct / 100);
  const taxableBase = Math.max(0, gross - pension);
  const pa = effectivePersonalAllowance(rules, taxableBase);
  const taxableIncome = Math.max(0, taxableBase - pa);
  const tax = incomeTax(rules, taxableIncome);
  const ni = class1NI(rules, gross);
  const sl = studentLoanDue(rules, input.studentLoanPlan || null, gross);
  const other = 0; // placeholder for benefits-in-kind etc.
  const net = gross - tax - ni - sl - pension - other;

  const waterfall = [
    { label: 'Gross', value: gross },
    { label: 'Income Tax', value: -tax },
    { label: 'NI', value: -ni },
    { label: 'Student Loan', value: -sl },
    { label: 'Pension', value: -pension },
    { label: 'Other', value: -other },
    { label: 'Net', value: net }
  ];

  // EMTR curve (simple discrete derivative)
  const points = [];
  const step = 2000; // £2k steps
  for (let y = 0; y <= 200000; y += step) {
    const base = computeTakeHome({ salary: y, pensionPct, studentLoanPlan: input.studentLoanPlan, _loop: true });
    const more = computeTakeHome({ salary: y + 100, pensionPct, studentLoanPlan: input.studentLoanPlan, _loop: true });
    const deltaNet = (more.net - base.net);
    const emtr = 1 - (deltaNet / 100); // marginal tax on the next £100
    points.push({ income: y, emtr: Math.max(0, Math.min(1, emtr)) });
  }
  if (!input._loop) {
    return { gross, net, tax, ni, sl, pension, pa, waterfall, emtrPoints: points };
  }
  return { net };
}

module.exports = { computeTakeHome };
