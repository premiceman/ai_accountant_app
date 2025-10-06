const { randomUUID } = require('crypto');

const CATEGORY_LABELS = {
  cash: 'Cash & savings',
  savings: 'Cash & savings',
  investments: 'Investments',
  property: 'Property',
  pension: 'Pension',
  business: 'Business',
  other: 'Other'
};

const CATEGORY_GROWTH = {
  cash: 0.01,
  savings: 0.01,
  investments: 0.05,
  property: 0.03,
  pension: 0.04,
  business: 0.06,
  other: 0.02
};

const DEFAULT_INFLATION = 0.025;
const PROJECTION_HORIZON_MONTHS = 120;

function round(value, digits = 2) {
  const factor = Math.pow(10, digits);
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function addMonths(base, count) {
  const d = new Date(base.getTime());
  d.setMonth(d.getMonth() + count);
  return d;
}

function monthsBetween(start, end) {
  const a = new Date(start);
  const b = new Date(end);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.max(0, Math.round((b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())));
}

function firstPositive(...values) {
  for (const value of values) {
    if (value == null) continue;
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return null;
}

function computeAssetClasses(assets = []) {
  const totals = new Map();
  assets.forEach((asset) => {
    const key = String(asset.category || 'other').toLowerCase();
    const value = Number(asset.value || 0);
    if (!Number.isFinite(value) || value <= 0) return;
    const current = totals.get(key) || 0;
    totals.set(key, current + value);
  });
  const overall = Array.from(totals.values()).reduce((sum, value) => sum + value, 0);
  return Array.from(totals.entries()).map(([key, total]) => {
    const label = CATEGORY_LABELS[key] || key.replace(/\b\w/g, (c) => c.toUpperCase());
    const assumedGrowth = CATEGORY_GROWTH[key] ?? CATEGORY_GROWTH.other;
    return {
      key,
      label,
      total: round(total),
      weight: overall > 0 ? round(total / overall, 4) : 0,
      assumedGrowth
    };
  }).sort((a, b) => b.total - a.total);
}

function buildLiabilitySchedule(liability = {}, fallbackBudget = 0) {
  const startingBalance = Math.max(0, Number(liability.balance || 0));
  const annualRate = Math.max(0, Number(liability.rate || 0));
  const monthlyRate = annualRate / 100 / 12;
  const baseMinimum = Math.max(0, Number(liability.minimumPayment || 0));
  let standardPayment = baseMinimum;

  if (!standardPayment) {
    if (monthlyRate > 0) {
      const assumedTermMonths = 120;
      const numerator = startingBalance * monthlyRate * Math.pow(1 + monthlyRate, assumedTermMonths);
      const denominator = Math.pow(1 + monthlyRate, assumedTermMonths) - 1;
      standardPayment = denominator !== 0 ? numerator / denominator : startingBalance / assumedTermMonths;
    } else {
      standardPayment = startingBalance / 120;
    }
  }

  if (fallbackBudget > 0) {
    const suggested = fallbackBudget * 0.25;
    standardPayment = Math.max(standardPayment, suggested);
  }

  standardPayment = Math.max(standardPayment, startingBalance > 0 ? Math.max(25, startingBalance / 240) : 0);

  const rows = [];
  let remaining = startingBalance;
  let month = 1;
  let totalInterest = 0;
  const horizon = 360;

  while (remaining > 0 && month <= horizon) {
    const interest = remaining * monthlyRate;
    totalInterest += interest;
    let payment = standardPayment;
    let principal = payment - interest;

    if (principal <= 0) {
      // Interest-only scenario, break to avoid infinite loop
      rows.push({
        month,
        payment: round(payment),
        interest: round(interest),
        principal: 0,
        balance: round(remaining + interest)
      });
      remaining += interest;
      break;
    }

    if (principal > remaining) {
      principal = remaining;
      payment = interest + principal;
    }

    remaining = Math.max(0, remaining - principal);

    rows.push({
      month,
      payment: round(payment),
      interest: round(interest),
      principal: round(principal),
      balance: round(remaining)
    });

    if (remaining <= 0.5) {
      remaining = 0;
      break;
    }

    month += 1;
  }

  const payoffMonths = remaining <= 0 ? rows.length : null;
  const payoffDate = payoffMonths ? addMonths(new Date(), payoffMonths) : null;

  return {
    id: liability.id || randomUUID(),
    name: liability.name || 'Liability',
    rate: annualRate,
    startingBalance: round(startingBalance),
    monthlyPayment: round(standardPayment),
    payoffMonths,
    payoffDate,
    totalInterest: round(totalInterest),
    schedule: rows
  };
}

function computeLiabilityBalances(schedules, horizon) {
  const balances = new Array(horizon).fill(0);
  schedules.forEach((schedule) => {
    const monthToBalance = new Map();
    schedule.schedule.forEach((entry) => {
      monthToBalance.set(entry.month, entry.balance);
    });
    let carry = schedule.startingBalance;
    for (let month = 1; month <= horizon; month += 1) {
      if (monthToBalance.has(month)) {
        carry = monthToBalance.get(month);
      }
      balances[month - 1] += carry;
    }
  });
  return balances.map((value) => round(value));
}

function computeProjections(options) {
  const {
    assetsTotal,
    assetClasses,
    liabilitySchedules,
    monthlyContribution,
    inflationRate,
    horizon
  } = options;

  const weightedReturn = assetClasses.length
    ? assetClasses.reduce((sum, cls) => sum + (cls.total * cls.assumedGrowth), 0) / (assetsTotal || 1)
    : 0.03;

  const monthlyReturn = weightedReturn / 12;
  const liabilityBalances = computeLiabilityBalances(liabilitySchedules, horizon);
  const monthlyProjection = [];
  let projectedAssets = assetsTotal;

  for (let month = 1; month <= horizon; month += 1) {
    projectedAssets = (projectedAssets + monthlyContribution) * (1 + monthlyReturn);
    const liabilities = liabilityBalances[month - 1] || 0;
    const netWorth = projectedAssets - liabilities;
    const inflationFactor = Math.pow(1 + inflationRate, month / 12);
    const realNetWorth = inflationFactor > 0 ? netWorth / inflationFactor : netWorth;
    monthlyProjection.push({
      month,
      assets: round(projectedAssets),
      liabilities: round(liabilities),
      netWorth: round(netWorth),
      realNetWorth: round(realNetWorth)
    });
  }

  const yearlyProjection = [];
  for (let year = 1; year <= Math.floor(horizon / 12); year += 1) {
    const sample = monthlyProjection[year * 12 - 1];
    if (sample) {
      yearlyProjection.push({
        year,
        assets: sample.assets,
        liabilities: sample.liabilities,
        netWorth: sample.netWorth,
        realNetWorth: sample.realNetWorth
      });
    }
  }

  return {
    horizonMonths: horizon,
    monthly: monthlyProjection,
    yearly: yearlyProjection,
    assumptions: {
      annualReturn: round(weightedReturn, 4),
      inflationRate: round(inflationRate, 4),
      monthlyContribution: round(monthlyContribution, 2)
    }
  };
}

function computeStrategy(liabilities, goals, schedules, monthlyContribution, availableForGoals) {
  const openLiabilities = liabilities.filter((item) => item.status !== 'closed');
  const sortedLiabilities = openLiabilities
    .slice()
    .sort((a, b) => Number(b.rate || 0) - Number(a.rate || 0));

  const scheduleMap = new Map();
  schedules.forEach((schedule) => {
    scheduleMap.set(schedule.id, schedule);
  });

  const steps = [];
  let cursor = 1;
  sortedLiabilities.forEach((liability) => {
    const schedule = scheduleMap.get(liability.id) || buildLiabilitySchedule(liability, monthlyContribution);
    const months = schedule.payoffMonths;
    steps.push({
      id: schedule.id,
      type: 'debt',
      title: `Clear ${liability.name}`,
      summary: `Direct £${Math.round(schedule.monthlyPayment).toLocaleString()} per month towards ${liability.name} at ${Number(liability.rate || 0).toFixed(2)}% interest.`,
      startMonth: cursor,
      endMonth: months ? cursor + months - 1 : null
    });
    if (months) cursor += months;
  });

  if (monthlyContribution > 0) {
    steps.push({
      id: randomUUID(),
      type: 'invest',
      title: 'Automate monthly investing',
      summary: `Invest £${Math.round(monthlyContribution).toLocaleString()} per month into diversified accounts once priority debts are cleared.`,
      startMonth: cursor,
      endMonth: cursor + 24
    });
  }

  const milestones = goals.map((goal) => {
    const targetAmount = Number(goal.targetAmount || 0);
    const monthsToGoal = availableForGoals > 0 ? Math.ceil(targetAmount / availableForGoals) : null;
    const recommendedDate = monthsToGoal ? addMonths(new Date(), monthsToGoal) : null;
    const targetMonths = goal.targetDate ? monthsBetween(new Date(), goal.targetDate) : null;
    return {
      id: goal.id || randomUUID(),
      title: goal.name || 'Goal',
      description: monthsToGoal
        ? `At £${Math.round(availableForGoals).toLocaleString()} per month you will reach £${Math.round(targetAmount).toLocaleString()} in approximately ${monthsToGoal} months.`
        : 'Increase savings capacity to reach this objective.',
      date: recommendedDate,
      amount: targetAmount,
      monthlyContribution: monthsToGoal ? Math.round(targetAmount / monthsToGoal) : null,
      targetMonths
    };
  });

  return { steps, milestones };
}

function computeWealth(plan = {}) {
  const assets = Array.isArray(plan.assets) ? plan.assets : [];
  const liabilities = Array.isArray(plan.liabilities) ? plan.liabilities : [];
  const goals = Array.isArray(plan.goals) ? plan.goals : [];
  const contributions = plan.contributions || { monthly: 0 };
  const monthlyContribution = Math.max(0, Number(contributions.monthly || 0));
  const inflationRate = plan.assumptions?.inflationRate != null
    ? Math.max(0, Number(plan.assumptions.inflationRate))
    : DEFAULT_INFLATION;

  const assetsTotal = assets.reduce((sum, asset) => sum + Number(asset.value || 0), 0);
  const liabilitiesTotal = liabilities.reduce((sum, liability) => sum + Number(liability.balance || 0), 0);
  const netWorth = assetsTotal - liabilitiesTotal;
  const denominator = assetsTotal + liabilitiesTotal;
  const ratio = denominator > 0 ? (netWorth / denominator) : 0;
  const strength = Math.max(0, Math.min(100, Math.round((ratio * 50) + 50)));
  const cashTotal = assets
    .filter((asset) => ['cash', 'savings'].includes(String(asset.category || '').toLowerCase()))
    .reduce((sum, asset) => sum + Number(asset.value || 0), 0);

  const assetClasses = computeAssetClasses(assets);
  const schedules = liabilities
    .filter((liability) => liability.status !== 'closed')
    .map((liability) => buildLiabilitySchedule(liability, monthlyContribution));

  const debtService = schedules.reduce((sum, schedule) => sum + Number(schedule.monthlyPayment || 0), 0);

  const monthlyIncomeRaw = firstPositive(
    plan.cashflow?.incomeMonthly,
    plan.analytics?.incomeMonthly,
    plan.analytics?.income?.monthly
  );

  const monthlySpendRaw = firstPositive(
    plan.cashflow?.spendMonthly,
    plan.analytics?.spendMonthly,
    plan.analytics?.spend?.monthly
  );

  const estimatedIncome = monthlyIncomeRaw != null
    ? monthlyIncomeRaw
    : (monthlySpendRaw != null ? monthlySpendRaw + monthlyContribution + debtService : null);

  const monthlyIncome = estimatedIncome != null ? round(estimatedIncome, 2) : null;

  const monthlySpend = monthlySpendRaw != null
    ? round(monthlySpendRaw, 2)
    : (monthlyIncome != null ? round(Math.max(0, monthlyIncome - monthlyContribution - debtService), 2) : null);

  const freeCashflow = (monthlyIncome != null && monthlySpend != null)
    ? Math.max(0, monthlyIncome - monthlySpend - debtService - monthlyContribution)
    : Math.max(0, monthlyContribution - debtService);

  const savingsRateCurrent = monthlyIncome ? round(monthlyContribution / monthlyIncome, 3) : null;

  const recommendedSavingsRate = (monthlyIncome != null && monthlySpend != null)
    ? clamp((monthlyIncome - monthlySpend - debtService) / monthlyIncome, 0.1, 0.35)
    : null;

  const recommendedContribution = recommendedSavingsRate != null
    ? Math.max(0, Math.round(recommendedSavingsRate * monthlyIncome))
    : null;

  const safeMonthlySavings = recommendedContribution != null
    ? recommendedContribution
    : Math.max(0, monthlyContribution + Math.max(0, freeCashflow));

  const affordabilityNotes = [];
  if (monthlyIncome != null && monthlySpend != null) {
    const spendRatio = monthlyIncome > 0 ? monthlySpend / monthlyIncome : null;
    if (spendRatio != null && spendRatio > 0.6) {
      affordabilityNotes.push('Discretionary spending is above 60% of income; trim non-essentials to accelerate saving.');
    }
  }
  if (debtService > 0 && monthlyIncome != null) {
    const ratio = debtService / monthlyIncome;
    if (ratio > 0.35) {
      affordabilityNotes.push('Debt servicing exceeds 35% of monthly income. Consider refinancing or prioritising overpayments.');
    }
  }
  if (freeCashflow <= 0.01) {
    affordabilityNotes.push('Cashflow after contributions is tight. Revisit savings rates or reduce upcoming commitments.');
  }

  const availableForGoals = safeMonthlySavings;

  const goalScenarios = goals.map((goal) => {
    const amount = Number(goal.targetAmount || 0);
    const recommendedMonths = availableForGoals > 0 ? Math.ceil(amount / availableForGoals) : null;
    return {
      id: goal.id || randomUUID(),
      name: goal.name || 'Goal',
      amount,
      recommendedMonths,
      targetDate: goal.targetDate ? new Date(goal.targetDate) : null
    };
  });

  const runwayBaseline = monthlySpend != null && monthlySpend > 0 ? monthlySpend : monthlyContribution || 0;
  const runwayMonths = runwayBaseline > 0 ? Math.max(0, Math.round(cashTotal / runwayBaseline)) : null;

  const projections = computeProjections({
    assetsTotal,
    assetClasses,
    liabilitySchedules: schedules,
    monthlyContribution,
    inflationRate,
    horizon: PROJECTION_HORIZON_MONTHS
  });

  const strategy = computeStrategy(liabilities, goals, schedules, monthlyContribution, availableForGoals);

  const summary = {
    assetsTotal: round(assetsTotal),
    liabilitiesTotal: round(liabilitiesTotal),
    netWorth: round(netWorth),
    strength,
    runwayMonths,
    cashReserves: round(cashTotal),
    lastComputed: new Date(),
    assetAllocation: assetClasses,
    liabilitySchedule: schedules,
    projections,
    affordability: {
      monthlyIncome,
      monthlySpend,
      monthlyContribution,
      debtService: round(debtService, 2),
      freeCashflow: round(freeCashflow, 2),
      savingsRateCurrent,
      recommendedSavingsRate: recommendedSavingsRate != null ? round(recommendedSavingsRate, 3) : null,
      recommendedContribution,
      safeMonthlySavings: round(safeMonthlySavings, 2),
      goalScenarios,
      advisories: affordabilityNotes
    }
  };

  return { summary, strategy };
}

module.exports = {
  computeWealth
};
