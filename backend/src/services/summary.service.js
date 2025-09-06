// backend/src/services/summary.service.js
const { paths, readJsonSafe } = require('../store/jsondb');

const money = n => Number(n || 0);
const sum = (arr, pick = x => x) => arr.reduce((a, b) => a + money(pick(b)), 0);

// ---------- Range helpers ----------
function lastMonthRange(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end   = new Date(now.getFullYear(), now.getMonth(), 1);
  return { start, end, preset: 'last-month' };
}
function lastQuarterRange(now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const q = Math.floor(m / 3);
  const prevQ = (q + 3) % 4;
  const startYear = q === 0 ? y - 1 : y;
  const startMonth = prevQ * 3;
  const start = new Date(startYear, startMonth, 1);
  const end   = new Date(y, q * 3, 1);
  return { start, end, preset: 'last-quarter' };
}
function lastYearRange(now = new Date()) {
  const end = now;
  const start = new Date(now);
  start.setFullYear(start.getFullYear() - 1);
  return { start, end, preset: 'last-year' };
}
function customRange(startStr, endStr) {
  const start = new Date(startStr);
  const end   = new Date(endStr);
  if (isNaN(start) || isNaN(end)) return null;
  return { start, end, preset: 'custom' };
}
function pickRange(opts = {}, now = new Date()) {
  if (opts?.preset === 'last-month')   return lastMonthRange(now);
  if (opts?.preset === 'last-quarter') return lastQuarterRange(now);
  if (opts?.preset === 'last-year')    return lastYearRange(now);
  if (opts?.start && opts?.end)        return customRange(opts.start, opts.end);
  return lastMonthRange(now);
}
function daysBetween(a, b) { return Math.max(1, Math.round((b - a) / (1000*60*60*24))); }
function prevComparableRange(range) {
  const lenDays = daysBetween(range.start, range.end);
  const end2 = new Date(range.start);
  const start2 = new Date(end2); start2.setDate(start2.getDate() - lenDays);
  return { start: start2, end: end2 };
}

// ---------- Month grid for portfolio ----------
function monthLabelsInRange(range) {
  const out = [];
  const d = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
  const end = new Date(range.end.getFullYear(), range.end.getMonth(), 1);
  while (d < end) { out.push(new Date(d)); d.setMonth(d.getMonth() + 1); }
  if (out.length === 0) out.push(new Date(range.start.getFullYear(), range.start.getMonth(), 1));
  return out;
}

// ---------- Categorisation ----------
function categorizeSpend(trans) {
  const map = new Map();
  for (const t of trans) {
    const amt = money(t.amount);
    if (amt >= 0) continue;
    const k = (t.category || 'Other spend').trim();
    map.set(k, (map.get(k) || 0) + Math.abs(amt));
  }
  return [...map.entries()].map(([name, amount]) => ({ name, amount }));
}
function categorizeIncome(trans) {
  const map = new Map();
  for (const t of trans) {
    const amt = money(t.amount);
    if (amt <= 0) continue;
    const k = (t.category || 'Other income').trim();
    map.set(k, (map.get(k) || 0) + amt);
  }
  return [...map.entries()].map(([name, amount]) => ({ name, amount }));
}

// ---------- Prices accessors ----------
function buildSeriesMap(pricesHistory) {
  const map = new Map();
  for (const s of pricesHistory.series || []) {
    const data = (s.data || []).map(p => ({ date: new Date(p.date), price: money(p.price) }))
                                .filter(p => !isNaN(p.date))
                                .sort((a,b)=> a.date - b.date);
    map.set(s.symbol, data);
  }
  return map;
}
function priceOnOrBefore(series, when) {
  if (!series || series.length === 0) return null;
  let lo = 0, hi = series.length - 1, best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const pt = series[mid];
    if (pt.date <= when) { best = pt; lo = mid + 1; } else { hi = mid - 1; }
  }
  return best ? best.price : null;
}
function lastPriceFromSeries(series) { return (!series || !series.length) ? 0 : series[series.length - 1].price; }

// ---------- UK 2025/26 tax estimation ----------
const TAX = {
  PA: 12570,                    // personal allowance
  BASIC_END: 50270,             // end of 20% band (taxable income)
  ADDL_START: 125140,           // 45% above
  DIVIDEND_ALLOWANCE: 500,      // per 2025/26
  DIV_RATES: { basic: 0.0875, higher: 0.3375, addl: 0.3935 }
};
function personalAllowanceAdjusted(annualIncome) {
  if (annualIncome <= 100000) return TAX.PA;
  const reduction = Math.floor((annualIncome - 100000) / 2);
  return Math.max(0, TAX.PA - reduction);
}
function incomeTaxOnSalary(taxableSalary) {
  let tax = 0;
  if (taxableSalary <= 0) return 0;
  const b = Math.min(taxableSalary, TAX.BASIC_END);
  tax += b * 0.20;
  if (taxableSalary > TAX.BASIC_END) {
    const h = Math.min(taxableSalary, TAX.ADDL_START) - TAX.BASIC_END;
    tax += Math.max(0, h) * 0.40;
  }
  if (taxableSalary > TAX.ADDL_START) {
    const a = taxableSalary - TAX.ADDL_START;
    tax += Math.max(0, a) * 0.45;
  }
  return tax;
}
function dividendTax(dividends, baseTaxableIncome) {
  // dividends sit on top of other taxable income
  if (dividends <= 0) return 0;
  let remaining = Math.max(0, dividends - TAX.DIVIDEND_ALLOWANCE);
  if (remaining <= 0) return 0;
  let tax = 0;
  const basicHeadroom  = Math.max(0, TAX.BASIC_END - baseTaxableIncome);
  const basicPart = Math.min(remaining, basicHeadroom);
  tax += basicPart * TAX.DIV_RATES.basic; remaining -= basicPart;

  const higherHeadroom = Math.max(0, TAX.ADDL_START - (baseTaxableIncome + basicPart));
  const higherPart = Math.min(remaining, higherHeadroom);
  tax += higherPart * TAX.DIV_RATES.higher; remaining -= higherPart;

  if (remaining > 0) tax += remaining * TAX.DIV_RATES.addl;
  return tax;
}
function bandLabelFromAnnual(annualIncome) {
  const pa = personalAllowanceAdjusted(annualIncome);
  const taxable = Math.max(0, annualIncome - pa);
  if (taxable <= 0) return 'Nil rate';
  if (taxable <= TAX.BASIC_END) return 'Basic rate';
  if (taxable <= TAX.ADDL_START) return 'Higher rate';
  return 'Additional rate';
}

// ---------- Other helpers ----------
function computeAllocation(holdings) {
  const buckets = new Map();
  for (const h of holdings) {
    const cls = h.assetClass || 'Unknown';
    const val = money(h.qty) * money(h.lastPrice || 0);
    buckets.set(cls, (buckets.get(cls) || 0) + val);
  }
  const total = sum([...buckets.values()]);
  return [...buckets.entries()].map(([label, v]) => ({ label, pct: total ? Math.round((v / total) * 100) : 0 }));
}
function computeYTD(history) {
  if (!history || history.length < 2) return 0;
  const first = history[0].value || 1;
  const last  = history[history.length - 1].value || first;
  return (last / first - 1) * 100;
}
function taxYearLabel(d = new Date()) {
  const y = d.getFullYear(), start = new Date(y, 3, 6);
  const a = d >= start ? y : y - 1;
  return `${a}/${String((a + 1) % 100).padStart(2, '0')}`;
}

// ---------- Main builder ----------
async function buildSummary(now = new Date(), rangeOpts = {}) {
  const accounts = await readJsonSafe(paths.accounts, { accounts: [] });
  const txAll    = await readJsonSafe(paths.transactions, { transactions: [] });
  const holds    = await readJsonSafe(paths.holdings, { holdings: [] });
  const prices   = await readJsonSafe(paths.prices, { prices: [] });
  const hist     = await readJsonSafe(paths.pricesHistory, { series: [] });

  const seriesMap= buildSeriesMap(hist);
  const spotMap  = new Map((prices.prices || []).map(p => [p.symbol, money(p.price)]));

  const holdings = (holds.holdings || []).map(h => {
    const s = seriesMap.get(h.symbol);
    const last = lastPriceFromSeries(s) ?? spotMap.get(h.symbol) ?? h.lastPrice ?? 0;
    return { ...h, lastPrice: last };
  });

  // Net worth (snapshot)
  const cash   = sum((accounts.accounts || []).filter(a => a.type === 'cash' || a.type === 'savings'), a => a.balance);
  const invBal = sum((accounts.accounts || []).filter(a => a.type === 'investment'), a => a.balance)
                || sum(holdings, h => h.qty * (h.lastPrice || 0));
  const assets = sum((accounts.accounts || []).filter(a => a.type === 'asset'), a => a.balance);
  const credit = sum((accounts.accounts || []).filter(a => a.type === 'credit'), a => a.balance);
  const loans  = sum((accounts.accounts || []).filter(a => a.type === 'loan'), a => a.balance);
  const netWorthTotal = cash + invBal + assets - credit - loans;

  // Range + previous comparable
  const range = pickRange(rangeOpts, now);
  const prev  = prevComparableRange(range);

  // Filter transactions
  const txInRange = (txAll.transactions || []).filter(t => {
    const d = new Date(t.date);
    return d >= range.start && d < range.end;
  });
  const txPrev = (txAll.transactions || []).filter(t => {
    const d = new Date(t.date);
    return d >= prev.start && d < prev.end;
  });

  // Income & spend + categories
  const incomeTotal = sum(txInRange.filter(t => money(t.amount) > 0), t => t.amount);
  const spendTotal  = sum(txInRange.filter(t => money(t.amount) < 0), t => -t.amount);
  const spendCats   = categorizeSpend(txInRange).sort((a,b)=> b.amount - a.amount);
  const incomeCats  = categorizeIncome(txInRange).sort((a,b)=> b.amount - a.amount);

  // Expense trends vs previous period
  const prevSpendCats = categorizeSpend(txPrev);
  const prevMap = new Map(prevSpendCats.map(c => [c.name, c.amount]));
  const expensesTop = spendCats.slice(0, 5).map(c => {
    const prevAmt = money(prevMap.get(c.name) || 0);
    const change = prevAmt === 0 ? (c.amount > 0 ? 100 : 0) : ((c.amount - prevAmt) / prevAmt) * 100;
    return { name: c.name, amount: c.amount, prevAmount: prevAmt, changePct: Math.round(change) };
  });

  // Range-aware waterfall (positive bars)
  const ORDER_SPEND = ['Rent/Mortgage','Food & Groceries','Utilities','Transport','Shopping','Travel','Insurance','Entertainment','Gifts'];
  const spendMap = new Map(spendCats.map(c => [c.name, c.amount]));
  const wfIncome = incomeCats.map(c => ({ label: c.name, amount: c.amount }));
  const wfSpend  = [
    ...ORDER_SPEND.filter(k => spendMap.has(k)).map(k => ({ label: k, amount: spendMap.get(k) })),
    ...spendCats.filter(c => !ORDER_SPEND.includes(c.name)).map(c => ({ label: c.name, amount: c.amount }))
  ];
  const waterfall = [...wfIncome, ...wfSpend, { label: 'Net retained', amount: Math.max(0, incomeTotal - spendTotal) }];

  // Portfolio history in range
  const months = monthLabelsInRange(range);
  const portfolioHistory = months.map(ms => {
    const value = holdings.reduce((acc, h) => {
      const s = seriesMap.get(h.symbol);
      const px = priceOnOrBefore(s, ms);
      if (px == null) return acc;
      return acc + money(h.qty) * px;
    }, 0);
    return { label: ms.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }), value: Math.round(value) };
  });
  const allocation = computeAllocation(holdings);
  const ytd = computeYTD(portfolioHistory);

  // --- Tax KPIs (annualised from the selected range; pro-rate back to range for HMRC position)
  const days = daysBetween(range.start, range.end);
  const annualise = v => v * (365 / days);

  // Break income by type (Salary, Dividends, Interest etc.)
  const incMap = new Map(incomeCats.map(c => [c.name.toLowerCase(), c.amount]));
  const salaryAnn    = annualise(money(incMap.get('salary') || 0));
  const dividendsAnn = annualise(money(incMap.get('dividends') || 0));
  const otherAnn     = annualise(incomeTotal - money(incMap.get('salary') || 0) - money(incMap.get('dividends') || 0));

  const grossAnnualIncome = salaryAnn + dividendsAnn + otherAnn;
  const pa = personalAllowanceAdjusted(grossAnnualIncome);

  const taxableSalary = Math.max(0, salaryAnn + otherAnn - pa);
  const taxSalary = incomeTaxOnSalary(taxableSalary);

  const baseTaxableAfterSalary = taxableSalary; // used for dividend stacking
  const taxDividends = dividendTax(dividendsAnn, baseTaxableAfterSalary);

  const estTaxAnnual = taxSalary + taxDividends;
  const estTaxForRange = estTaxAnnual * (days / 365);

  // payments to HMRC observed in the range (rough heuristic by category text)
  const TAX_KEYS = ['hmrc', 'self assessment', 'income tax', 'paye', 'tax payment'];
  const taxPaymentsInRange = sum(
    txInRange.filter(t => {
      const isOut = money(t.amount) < 0;
      const cat = (t.category || '').toLowerCase();
      return isOut && TAX_KEYS.some(k => cat.includes(k));
    }),
    t => -t.amount
  );
  const hmrcNet = estTaxForRange - taxPaymentsInRange;
  const hmrcLabel = hmrcNet > 0 ? `Owe HMRC £${Math.round(hmrcNet).toLocaleString()}` :
                    hmrcNet < 0 ? `HMRC owes you £${Math.abs(Math.round(hmrcNet)).toLocaleString()}` :
                                  'Settled';

  const taxBand = bandLabelFromAnnual(grossAnnualIncome);

  // EMTR curve based on annualised income scale
  const maxForCurve = Math.max(60000, Math.ceil(grossAnnualIncome * 1.3));
  const emtr = emtrCurveForAnnualIncome(maxForCurve);

  // Gauges (annual constructs; left as placeholders)
  const gauges = {
    personalAllowance: { used: 12570, total: 12570 },
    dividendAllowance: { used: 300,   total: 500 },
    cgtAllowance:      { used: 1500,  total: 3000 },
    pensionAnnual:     { used: 12000, total: 60000 },
    isa:               { used: 6000,  total: 20000 }
  };

  return {
    year: taxYearLabel(now),
    currency: 'GBP',
    range: { start: range.start.toISOString(), end: range.end.toISOString(), preset: range.preset },
    waterfall,
    emtr,
    gauges,
    kpis: {
      taxBand,
      hmrc: {
        estTaxAnnual: Math.round(estTaxAnnual),
        estTaxForRange: Math.round(estTaxForRange),
        paymentsInRange: Math.round(taxPaymentsInRange),
        netForRange: Math.round(hmrcNet),
        label: hmrcLabel
      },
      incomeTotal: Math.round(incomeTotal),
      spendTotal: Math.round(spendTotal)
    },
    trends: {
      expensesTop // [{name, amount, prevAmount, changePct}]
    },
    financialPosture: {
      asOf: now.toLocaleDateString(),
      netWorth: { total: netWorthTotal, savings: cash, investments: invBal, assets, credit, loans },
      lastMonth: { // actually the selected range
        incomeTotal, spendTotal,
        incomeNote: 'Inflows within selected range (annualised for tax band)',
        spendNote:  'Outflows by category within range',
        categories: categorizeSpend(txInRange)
      },
      investments: { ytdReturnPct: ytd, allocation, history: portfolioHistory }
    }
  };
}

module.exports = { buildSummary };

// ---------- EMTR curve ----------
function emtrCurveForAnnualIncome(maxIncome = 150000) {
  const PA = 12570;
  const BASIC_END = 50270;
  const ADDL_START = 125140;
  function marginalRateAt(income) {
    if (income > 100000 && income <= ADDL_START) return 0.60; // taper zone
    if (income > ADDL_START) return 0.45;
    if (income > BASIC_END)  return 0.40;
    if (income <= PA)        return 0.00;
    return 0.20;
  }
  const points = [];
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const inc = Math.round((i / steps) * maxIncome);
    points.push({ income: inc, rate: marginalRateAt(inc) });
  }
  return points;
}
