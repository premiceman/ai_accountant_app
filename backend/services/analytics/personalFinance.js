// backend/services/analytics/personalFinance.js
const dayjs = require('dayjs');
const duration = require('dayjs/plugin/duration');
const utc = require('dayjs/plugin/utc');
const isSameOrAfter = require('dayjs/plugin/isSameOrAfter');
const isSameOrBefore = require('dayjs/plugin/isSameOrBefore');
const { readJsonSafe, paths } = require('../../src/store/jsondb');

dayjs.extend(duration);
dayjs.extend(utc);
dayjs.extend(isSameOrAfter);
dayjs.extend(isSameOrBefore);

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

// TODO(worker-refactor): Extract pure analytics modules (ranges, cashflow, hmrc, etc.)
// so BullMQ workers can compute and persist AnalyticsCache payloads independent of Express.

const CPI_INDEX = new Map([
  ['2023-10', 127.4],
  ['2023-11', 127.7],
  ['2023-12', 128.2],
  ['2024-01', 128.7],
  ['2024-02', 129.1],
  ['2024-03', 129.8],
  ['2024-04', 130.2],
  ['2024-05', 130.5],
  ['2024-06', 130.9],
  ['2024-07', 131.1],
  ['2024-08', 131.4],
  ['2024-09', 131.8],
  ['2024-10', 132.2],
  ['2024-11', 132.6],
  ['2024-12', 133.1],
]);

const ESSENTIAL_CATEGORIES = new Set([
  'rent/mortgage',
  'utilities',
  'insurance',
  'food & groceries',
  'transport',
  'council tax',
  'childcare',
]);

const TAX_KEYWORDS = ['hmrc', 'self assessment', 'paye', 'tax payment', 'national insurance'];

function cacheKey(userId, rangeKey, deltaMode) {
  return `${userId}:${rangeKey}:${deltaMode}`;
}

function toRangeKey(range) {
  return `${range.start.toISOString()}_${range.end.toISOString()}`;
}

function normaliseTransactions(transactions = []) {
  return transactions
    .map((tx) => ({
      ...tx,
      date: dayjs(tx.date).isValid() ? dayjs(tx.date).startOf('day').toDate() : null,
      amount: Number(tx.amount || 0),
      category: (tx.category || tx.personal_finance_category || 'Uncategorised').toString(),
      description: (tx.description || tx.merchant_name || tx.name || '').toString(),
    }))
    .filter((tx) => tx.date != null);
}

function groupBy(list, keyFn) {
  const map = new Map();
  for (const item of list) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function sum(list, fn = (x) => x) {
  return list.reduce((acc, item) => acc + Number(fn(item) || 0), 0);
}

function pickPrevRange(range) {
  const span = Math.max(1, dayjs(range.end).diff(dayjs(range.start), 'day') + 1);
  const prevEnd = dayjs(range.start).subtract(1, 'day');
  const prevStart = prevEnd.subtract(span - 1, 'day');
  return { start: prevStart.toDate(), end: prevEnd.toDate() };
}

function inflationIndexFor(monthKey) {
  if (CPI_INDEX.has(monthKey)) return CPI_INDEX.get(monthKey);
  const keys = Array.from(CPI_INDEX.keys()).sort();
  if (!keys.length) return 100;
  const before = keys.filter((k) => k <= monthKey).pop();
  return before ? CPI_INDEX.get(before) : CPI_INDEX.get(keys[0]);
}

function detectDuplicates(transactions) {
  const groups = groupBy(transactions, (tx) => {
    const amt = Math.round(Number(tx.amount || 0) * 100);
    const date = dayjs(tx.date).format('YYYY-MM-DD');
    const desc = (tx.description || 'unknown').trim().toLowerCase().replace(/\s+/g, ' ');
    return `${date}:${amt}:${desc}`;
  });

  const duplicates = [];
  for (const [, items] of groups.entries()) {
    if (items.length < 2) continue;
    duplicates.push({
      date: dayjs(items[0].date).format('YYYY-MM-DD'),
      amount: items[0].amount,
      description: items[0].description || 'Unlabelled transaction',
      count: items.length,
      accountIds: [...new Set(items.map((tx) => tx.accountId).filter(Boolean))],
    });
  }
  return duplicates.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

function categoriseSpend(transactions) {
  const outflows = transactions.filter((tx) => tx.amount < 0);
  const map = groupBy(outflows, (tx) => tx.category.toLowerCase());
  const result = [];
  for (const [category, items] of map.entries()) {
    const amount = -sum(items, (tx) => tx.amount);
    if (amount === 0) continue;
    result.push({
      category,
      label: category
        .split('/')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' / '),
      amount,
    });
  }
  const total = sum(result, (r) => r.amount) || 1;
  return result
    .map((r) => ({ ...r, share: r.amount / total }))
    .sort((a, b) => b.amount - a.amount);
}

function categoriseIncome(transactions) {
  const inflows = transactions.filter((tx) => tx.amount > 0);
  const map = groupBy(inflows, (tx) => tx.category.toLowerCase());
  const result = [];
  for (const [category, items] of map.entries()) {
    const amount = sum(items, (tx) => tx.amount);
    if (amount === 0) continue;
    result.push({
      category,
      label: category
        .split('/')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' / '),
      amount,
    });
  }
  return result.sort((a, b) => b.amount - a.amount);
}

function largestMerchants(transactions) {
  const map = groupBy(transactions.filter((tx) => tx.amount < 0), (tx) => {
    const name = (tx.merchant_name || tx.description || 'Unknown').trim();
    return name || 'Unknown';
  });
  const rows = [];
  for (const [name, items] of map.entries()) {
    const spend = -sum(items, (tx) => tx.amount);
    if (spend === 0) continue;
    rows.push({ name, amount: spend, transactions: items.length });
  }
  return rows.sort((a, b) => b.amount - a.amount).slice(0, 8);
}

function inflationAdjustedTrend(transactions, range, monthsBack = 6) {
  const end = dayjs(range.end);
  const points = [];
  for (let i = monthsBack - 1; i >= 0; i -= 1) {
    const monthStart = end.subtract(i, 'month').startOf('month');
    const monthEnd = monthStart.endOf('month');
    const key = monthStart.format('YYYY-MM');
    const nominal = -sum(
      transactions.filter((tx) => dayjs(tx.date).isSame(monthStart, 'month') && tx.amount < 0),
      (tx) => tx.amount,
    );
    const index = inflationIndexFor(key);
    const baseIndex = inflationIndexFor(end.format('YYYY-MM')) || 100;
    const real = nominal * (baseIndex / (index || baseIndex || 100));
    points.push({
      label: monthStart.format('MMM YYYY'),
      nominal: Math.round(nominal),
      real: Math.round(real),
    });
  }
  return points;
}

function wealthBreakdown(plan = {}) {
  const assets = Array.isArray(plan.assets) ? plan.assets : [];
  const liabilities = Array.isArray(plan.liabilities) ? plan.liabilities : [];
  const assetTotal = sum(assets, (a) => a.value || a.balance || 0);
  const liabilityTotal = sum(liabilities, (l) => l.balance || 0);

  const byCategory = groupBy(assets, (a) => (a.category || 'other').toLowerCase());
  const breakdown = [];
  for (const [cat, items] of byCategory.entries()) {
    const amount = sum(items, (item) => item.value || item.balance || 0);
    breakdown.push({
      label: cat
        .split('/')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' / '),
      value: amount,
    });
  }
  const totalAssetsForShare = sum(breakdown, (b) => b.value) || 1;
  const mix = breakdown.map((b) => ({ ...b, share: b.value / totalAssetsForShare }));

  return {
    assetsTotal: assetTotal,
    liabilitiesTotal: liabilityTotal,
    netWorth: assetTotal - liabilityTotal,
    assetMix: mix,
  };
}

function savingsCapacity(transactions, wealthPlan, range) {
  const income = sum(transactions.filter((tx) => tx.amount > 0), (tx) => tx.amount);
  const spend = -sum(transactions.filter((tx) => tx.amount < 0), (tx) => tx.amount);
  const essentials = -sum(
    transactions.filter((tx) => tx.amount < 0 && ESSENTIAL_CATEGORIES.has(tx.category.toLowerCase())),
    (tx) => tx.amount,
  );
  const discretionary = Math.max(0, spend - essentials);
  const contributions = Number(wealthPlan?.contributions?.monthly || 0);
  const net = income - spend - contributions;
  const durationDays = Math.max(1, dayjs(range.end).diff(range.start, 'day') + 1);
  const monthlyFactor = 30 / durationDays;
  const monthlyCapacity = net * monthlyFactor;
  const savingsRate = income ? Math.max(0, (income - spend) / income) : 0;

  return {
    income,
    spend,
    essentials,
    discretionary,
    contributions,
    rangeMonthlyCapacity: monthlyCapacity,
    savingsRate,
    status: monthlyCapacity >= 0 ? (monthlyCapacity > 500 ? 'ahead' : 'steady') : 'behind',
  };
}

function hmrcSummary(transactions, range, incomeAnnualised, deltaMode) {
  const days = Math.max(1, dayjs(range.end).diff(range.start, 'day') + 1);
  const annualise = (value) => value * (365 / days);
  const salary = sum(
    transactions.filter((tx) => tx.amount > 0 && tx.category.toLowerCase().includes('salary')),
    (tx) => tx.amount,
  );
  const dividends = sum(
    transactions.filter((tx) => tx.amount > 0 && tx.category.toLowerCase().includes('dividend')),
    (tx) => tx.amount,
  );
  const other = incomeAnnualised - annualise(salary) - annualise(dividends);

  const personalAllowance = 12570;
  const dividendAllowance = 500;
  const cgtAllowance = 3000;
  const pensionAllowance = 60000;
  const isaAllowance = 20000;

  const allowances = [
    { key: 'personalAllowance', label: 'Personal allowance', used: Math.min(personalAllowance, Math.max(0, annualise(salary) + other)), total: personalAllowance },
    { key: 'dividendAllowance', label: 'Dividend allowance', used: Math.min(dividendAllowance, Math.max(0, annualise(dividends))), total: dividendAllowance },
    { key: 'cgtAllowance', label: 'CGT annual exempt', used: Math.min(cgtAllowance, 0), total: cgtAllowance },
    { key: 'pensionAnnual', label: 'Pension annual allowance', used: Math.min(pensionAllowance, Math.max(0, annualise(salary) * 0.12)), total: pensionAllowance },
    { key: 'isaAllowance', label: 'ISA allowance', used: Math.min(isaAllowance, Math.max(0, annualise(dividends) * 0.25)), total: isaAllowance },
  ].map((entry) => ({
    ...entry,
    used: Math.round(entry.used),
    total: Math.round(entry.total),
    utilisation: entry.total ? entry.used / entry.total : 0,
  }));

  const hmrcOutflows = -sum(
    transactions.filter((tx) => tx.amount < 0 && TAX_KEYWORDS.some((kw) => (tx.description || '').toLowerCase().includes(kw))),
    (tx) => tx.amount,
  );

  const estimatedIncomeTax = Math.max(0, annualise(salary) * 0.22 + annualise(dividends) * 0.0875 + other * 0.2);
  const proRatedLiability = estimatedIncomeTax * (days / 365);
  const hmrcDelta = proRatedLiability - hmrcOutflows;

  const obligations = [];
  const today = dayjs();
  const deadlines = [
    { key: 'paymentOnAccount', label: 'Payment on account', due: dayjs(`${today.year()}-07-31`) },
    { key: 'selfAssessment', label: 'Self assessment filing', due: dayjs(`${today.year() + 1}-01-31`) },
  ];
  for (const item of deadlines) {
    const due = item.due.isBefore(today) ? item.due.add(1, 'year') : item.due;
    obligations.push({
      key: item.key,
      title: item.label,
      dueDate: due.toISOString(),
      amountDue: Math.max(0, Math.round(proRatedLiability / deadlines.length)),
      status: due.diff(today, 'day') <= 30 ? 'due-soon' : 'scheduled',
    });
  }

  const deltaValue = deltaMode === 'percent'
    ? (hmrcDelta === 0 ? 0 : (hmrcDelta / (Math.abs(proRatedLiability) || 1)) * 100)
    : hmrcDelta;

  return {
    allowances,
    obligations,
    balance: {
      value: Math.round(hmrcDelta),
      label: hmrcDelta > 0 ? 'Amount owed to HMRC' : hmrcDelta < 0 ? 'Credit from HMRC' : 'Settled',
      delta: deltaValue,
      deltaMode,
    },
  };
}

function buildAlerts({ duplicates, savings, hmrc, allowances, spendByCategory }) {
  const alerts = [];
  if (duplicates.length) {
    alerts.push({
      id: 'duplicates',
      severity: 'warning',
      title: 'Possible duplicate transactions',
      body: `${duplicates.length} entries share the same date and amount. Review before reconciling.`,
    });
  }
  if (savings.rangeMonthlyCapacity < 0) {
    alerts.push({
      id: 'cashflow',
      severity: 'danger',
      title: 'Negative savings capacity',
      body: 'Spending and commitments exceed income in the selected range. Consider trimming discretionary costs.',
    });
  }
  const tightAllowance = allowances.find((a) => a.utilisation > 0.9);
  if (tightAllowance) {
    alerts.push({
      id: `allowance-${tightAllowance.key}`,
      severity: 'warning',
      title: `${tightAllowance.label} nearly used`,
      body: `You have used ${Math.round(tightAllowance.utilisation * 100)}% of this allowance. Plan top-ups carefully.`,
    });
  }
  const dominantCategory = spendByCategory[0];
  if (dominantCategory && dominantCategory.share > 0.35) {
    alerts.push({
      id: 'concentration',
      severity: 'info',
      title: 'Spend concentrated in one area',
      body: `${dominantCategory.label} makes up ${(dominantCategory.share * 100).toFixed(1)}% of spend. Check for optimisation opportunities.`,
    });
  }
  if (hmrc.balance.value > 0) {
    alerts.push({
      id: 'hmrc-due',
      severity: 'danger',
      title: 'Provision for HMRC due',
      body: `Set aside £${Math.abs(hmrc.balance.value).toLocaleString()} for upcoming payments.`,
    });
  }
  return alerts;
}

function makeComparatives(current, previous, deltaMode) {
  const rows = [];
  for (const [key, label] of [
    ['income', 'Income'],
    ['spend', 'Spend'],
    ['essentials', 'Essentials'],
    ['discretionary', 'Discretionary'],
  ]) {
    const cur = Number(current[key] || 0);
    const prev = Number(previous[key] || 0);
    const deltaAbs = cur - prev;
    const deltaPct = prev === 0 ? (cur === 0 ? 0 : 100) : (deltaAbs / Math.abs(prev)) * 100;
    rows.push({ key, label, current: cur, previous: prev, deltaAbs, deltaPct });
  }
  return {
    label: 'vs previous period',
    mode: deltaMode,
    values: rows,
  };
}

async function loadTransactions() {
  const all = await readJsonSafe(paths.transactions, { transactions: [] });
  return normaliseTransactions(all.transactions || []);
}

async function computePersonalFinance({ user, range, deltaMode }) {
  const cacheId = cacheKey(user.id || user._id || 'unknown', toRangeKey(range), deltaMode);
  const cached = cache.get(cacheId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.payload;
  }

  const transactions = await loadTransactions();
  const inRange = transactions.filter((tx) => {
    const d = dayjs(tx.date);
    return d.isSameOrAfter(range.start, 'day') && d.isSameOrBefore(range.end, 'day');
  });
  const prevRange = pickPrevRange(range);
  const previousTx = transactions.filter((tx) => {
    const d = dayjs(tx.date);
    return d.isSameOrAfter(prevRange.start, 'day') && d.isSameOrBefore(prevRange.end, 'day');
  });

  const hasData = inRange.length > 0;
  const spendByCategory = categoriseSpend(inRange);
  const incomeByCategory = categoriseIncome(inRange);
  const duplicates = detectDuplicates(inRange);
  const merchants = largestMerchants(inRange);
  const inflationTrend = inflationAdjustedTrend(transactions, range, 6);
  const wealth = wealthBreakdown(user.wealthPlan || {});
  const coverageRatio = wealth.liabilitiesTotal
    ? wealth.assetsTotal / Math.max(1, wealth.liabilitiesTotal)
    : null;
  const savings = savingsCapacity(inRange, user.wealthPlan || {}, range);
  const hmrc = hmrcSummary(inRange, range, sum(incomeByCategory, (c) => c.amount) * (365 / Math.max(1, dayjs(range.end).diff(range.start, 'day'))), deltaMode);

  const prevSavings = savingsCapacity(previousTx, user.wealthPlan || {}, prevRange);
  const comparatives = makeComparatives(savings, prevSavings, deltaMode);
  const prevSpendByCategory = categoriseSpend(previousTx);
  const prevSpendMap = new Map(prevSpendByCategory.map((item) => [item.category, item.amount]));
  const topCosts = spendByCategory.slice(0, 5).map((item) => {
    const prevAmount = prevSpendMap.get(item.category) || 0;
    const change = prevAmount === 0
      ? (item.amount > 0 ? 100 : 0)
      : ((item.amount - prevAmount) / Math.abs(prevAmount)) * 100;
    return {
      label: item.label,
      value: Math.round(item.amount),
      change: Math.round(change),
    };
  });

  const alerts = buildAlerts({ duplicates, savings, hmrc, allowances: hmrc.allowances, spendByCategory });

  const metrics = [
    {
      key: 'income',
      label: 'Gross income',
      value: Math.round(savings.income),
      format: 'currency',
      delta: deltaMode === 'percent'
        ? (prevSavings.income === 0 ? (savings.income === 0 ? 0 : 100) : ((savings.income - prevSavings.income) / Math.abs(prevSavings.income)) * 100)
        : savings.income - prevSavings.income,
      deltaMode,
    },
    {
      key: 'spend',
      label: 'Total spend',
      value: Math.round(savings.spend),
      format: 'currency',
      delta: deltaMode === 'percent'
        ? (prevSavings.spend === 0 ? (savings.spend === 0 ? 0 : 100) : ((savings.spend - prevSavings.spend) / Math.abs(prevSavings.spend)) * 100)
        : savings.spend - prevSavings.spend,
      deltaMode,
    },
    {
      key: 'savingsCapacity',
      label: 'Savings capacity (monthly)',
      value: Math.round(savings.rangeMonthlyCapacity),
      format: 'currency',
      subLabel: savings.status === 'ahead'
        ? 'Plenty of headroom for goals.'
        : savings.status === 'steady'
          ? 'Balanced cashflow this period.'
          : 'Overspending detected this period.',
      delta: deltaMode === 'percent'
        ? (prevSavings.rangeMonthlyCapacity === 0
          ? (savings.rangeMonthlyCapacity === 0 ? 0 : 100)
          : ((savings.rangeMonthlyCapacity - prevSavings.rangeMonthlyCapacity) / Math.abs(prevSavings.rangeMonthlyCapacity)) * 100)
        : savings.rangeMonthlyCapacity - prevSavings.rangeMonthlyCapacity,
      deltaMode,
    },
    {
      key: 'hmrcBalance',
      label: hmrc.balance.label,
      value: hmrc.balance.value,
      format: 'currency',
      subLabel: 'Provision for obligations in this period.',
      delta: hmrc.balance.delta,
      deltaMode: hmrc.balance.deltaMode,
    },
  ];

  const payload = {
    range,
    preferences: user.preferences || {},
    hasData,
    accounting: {
      metrics,
      spendByCategory,
      incomeByCategory,
      duplicates,
      merchants,
      inflationTrend,
      allowances: hmrc.allowances,
      obligations: hmrc.obligations,
      alerts,
      comparatives,
      hmrcBalance: hmrc.balance,
    },
    financialPosture: {
      netWorth: {
        total: Math.round(wealth.netWorth),
        asOf: dayjs().format('D MMM YYYY'),
      },
      breakdown: [
        { label: 'Assets', value: Math.round(wealth.assetsTotal) },
        { label: 'Liabilities', value: Math.round(wealth.liabilitiesTotal) },
        { label: 'Net worth', value: Math.round(wealth.netWorth) },
      ],
      liquidity: {
        ratio: coverageRatio,
        label: coverageRatio != null ? `${coverageRatio.toFixed(2)}x asset coverage` : 'No liabilities recorded',
      },
      savings: {
        monthlyCapacity: Math.round(savings.rangeMonthlyCapacity),
        savingsRate: savings.savingsRate,
        essentials: Math.round(savings.essentials),
        discretionary: Math.round(savings.discretionary),
        contributions: Math.round(savings.contributions),
        note: savings.status === 'ahead'
          ? 'Comfortably covering commitments this period.'
          : savings.status === 'steady'
            ? 'Cashflow balanced; monitor upcoming expenses.'
            : 'Cashflow negative — plan adjustments.',
      },
      assetMix: wealth.assetMix,
      inflationTrend,
      income: {
        total: Math.round(savings.income),
        note: incomeByCategory.length
          ? `Top sources: ${incomeByCategory.slice(0, 2).map((c) => c.label).join(', ')}`
          : 'Connect payroll and other income sources to populate.',
        series: incomeByCategory.map((cat) => ({ label: cat.label, value: Math.round(cat.amount) })),
      },
      spend: {
        total: Math.round(savings.spend),
        note: spendByCategory.length
          ? `Largest areas: ${spendByCategory.slice(0, 2).map((c) => c.label).join(', ')}`
          : 'No spending recorded in this period.',
        series: spendByCategory.map((cat) => ({ label: cat.label, value: Math.round(cat.amount) })),
      },
      topCosts,
      investments: {
        allocation: wealth.assetMix.map((mix) => ({ label: mix.label, value: Math.round(mix.value) })),
        history: inflationTrend.map((point) => ({ label: point.label, value: point.real })),
        ytd: 0,
      },
    },
    aiInsights: alerts.slice(0, 3).map((alert) => ({
      title: alert.title,
      body: alert.body,
      action: alert.severity === 'danger' ? 'View action plan' : null,
    })),
    gating: {
      tier: user.licenseTier || 'free',
    },
    salaryNavigator: user.salaryNavigator || {},
    wealthPlan: user.wealthPlan || {},
  };

  cache.set(cacheId, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    payload,
  });

  return payload;
}

module.exports = {
  computePersonalFinance,
  __test__: {
    detectDuplicates,
    categoriseSpend,
    savingsCapacity,
    wealthBreakdown,
  },
};
