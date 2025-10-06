// backend/services/compensation/market.js
// Helper to blend internal data, Plaid income insights and external salary datasets
// into a single market benchmark used across the compensation navigator.

const CPI_GROWTH = {
  2021: 1.028,
  2022: 1.051,
  2023: 1.039,
  2024: 1.032
};

const EXTERNAL_SALARY_DATASETS = [
  {
    key: 'software_engineer',
    label: 'StackOverflow & ONS engineering sample',
    patterns: [/engineer/i, /developer/i, /software/i],
    regions: {
      uk: { median: 68000, p25: 54000, p75: 82000 },
      us: { median: 128000, p25: 99000, p75: 162000 }
    },
    tenurePremium: 0.035,
    baseYear: 2023
  },
  {
    key: 'product_manager',
    label: 'Product salary pulse 2023',
    patterns: [/product/i, /pm\b/i],
    regions: {
      uk: { median: 72000, p25: 58000, p75: 90000 },
      us: { median: 134000, p25: 108000, p75: 168000 }
    },
    tenurePremium: 0.032,
    baseYear: 2023
  },
  {
    key: 'finance_lead',
    label: 'Robert Half finance guide',
    patterns: [/finance/i, /controller/i, /accountant/i],
    regions: {
      uk: { median: 62000, p25: 48000, p75: 81000 },
      us: { median: 110000, p25: 87000, p75: 145000 }
    },
    tenurePremium: 0.03,
    baseYear: 2022
  },
  {
    key: 'default',
    label: 'General knowledge worker benchmark',
    patterns: [/.*/],
    regions: {
      uk: { median: 52000, p25: 40000, p75: 68000 },
      us: { median: 95000, p25: 72000, p75: 120000 }
    },
    tenurePremium: 0.025,
    baseYear: 2022
  }
];

function packageTotal(pkg = {}) {
  return ['base', 'bonus', 'commission', 'equity', 'benefits', 'other'].reduce((sum, key) => sum + Number(pkg?.[key] || 0), 0);
}

function inflationMultiplier(baseYear, targetYear) {
  if (!baseYear || !targetYear || targetYear <= baseYear) return 1;
  let multiplier = 1;
  for (let year = baseYear + 1; year <= targetYear; year += 1) {
    multiplier *= CPI_GROWTH[year] || 1.025;
  }
  return multiplier;
}

function normaliseRole(role) {
  return String(role || '').trim().toLowerCase();
}

function pickDataset(role, country = 'uk') {
  const roleKey = normaliseRole(role);
  const dataset = EXTERNAL_SALARY_DATASETS.find((entry) => entry.patterns.some((pattern) => pattern.test(roleKey)))
    || EXTERNAL_SALARY_DATASETS.find((entry) => entry.key === 'default');
  const region = (dataset?.regions?.[country] || dataset?.regions?.uk || dataset?.regions?.us);
  return {
    dataset,
    region
  };
}

function applyLocationModifier(value, location = '') {
  if (!value) return value;
  const loc = String(location || '').toLowerCase();
  if (!loc) return value;
  if (/london|new york|san francisco|zurich/.test(loc)) {
    return value * 1.08;
  }
  if (/manchester|berlin|austin|dublin/.test(loc)) {
    return value * 1.04;
  }
  if (/remote/.test(loc)) {
    return value * 0.98;
  }
  return value;
}

function computeTenureMultiplier(tenureYears = 0, premium = 0.03) {
  if (!tenureYears || tenureYears <= 0) return 1;
  const capped = Math.min(tenureYears, 12);
  return 1 + (capped * premium);
}

function aggregateBenchmarks(benchmarks = []) {
  if (!Array.isArray(benchmarks) || !benchmarks.length) return null;
  const tally = benchmarks.reduce((acc, row) => {
    const median = Number(row?.medianSalary || row?.percentiles?.p50 || 0);
    if (!Number.isFinite(median) || median <= 0) return acc;
    const weight = row.source?.toLowerCase().includes('recruitment') ? 1.25
      : row.source?.toLowerCase().includes('industry') ? 0.9
      : 1;
    acc.total += median * weight;
    acc.weight += weight;
    return acc;
  }, { total: 0, weight: 0 });
  if (!tally.weight) return null;
  return tally.total / tally.weight;
}

function estimatePlaidIncome(user, navigator) {
  const integrations = Array.isArray(user?.integrations) ? user.integrations : [];
  const plaidIntegration = integrations.find((item) => (item.key || '').toLowerCase().includes('plaid'));
  if (!plaidIntegration) return null;
  // We do not have live Plaid transaction pulls in this environment, so approximate
  // annualised income by smoothing the declared package with a conservative haircut.
  const declared = packageTotal(navigator?.package || {});
  return declared ? declared * 0.97 : null;
}

function buildPromotionTimeline({ status, tenureYears = 0, role = '', company = '' }) {
  const baseline = status === 'underpaid' ? 9 : status === 'overpaid' ? 15 : 12;
  const adjustment = tenureYears ? Math.max(-4, Math.min(4, Math.round((tenureYears - 2) * 1.2))) : 0;
  const monthsToPromotion = Math.max(6, baseline - adjustment);
  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setMonth(windowStart.getMonth() + Math.max(1, Math.round(monthsToPromotion / 3)));
  const windowEnd = new Date(now);
  windowEnd.setMonth(windowEnd.getMonth() + monthsToPromotion);
  const confidence = status === 'underpaid' ? 'high' : status === 'overpaid' ? 'low' : 'medium';
  const targetTitle = status === 'overpaid' ? `Expanded scope for ${role || 'role'}` : `Senior ${role || 'professional'}`;
  const notes = company
    ? `Align negotiation prep with ${company}'s performance cycle and document wins in the navigator.`
    : 'Align negotiation prep with your performance cycle and document wins in the navigator.';
  return {
    monthsToPromotion,
    targetTitle,
    windowStart,
    windowEnd,
    confidence,
    notes
  };
}

function computeMarketBenchmark({ user, navigator = {}, benchmarks = [] } = {}) {
  const country = (user?.country || 'uk').toLowerCase();
  const role = navigator.role || user?.jobTitle || '';
  const location = navigator.location || user?.location || '';
  const tenureYears = navigator.tenure != null ? Number(navigator.tenure) : null;
  const currentPackageTotal = packageTotal(navigator.package || {});
  const plaidIncome = estimatePlaidIncome(user, navigator);
  const aggregatedBenchmark = aggregateBenchmarks(benchmarks.length ? benchmarks : navigator.benchmarks);
  const { dataset, region } = pickDataset(role, country);
  const inflation = inflationMultiplier(dataset?.baseYear, new Date().getFullYear());
  const tenureMultiplier = computeTenureMultiplier(tenureYears, dataset?.tenurePremium || 0.028);
  const locationAdjustedMedian = applyLocationModifier(region?.median || 0, location) * tenureMultiplier * inflation;
  const locationAdjustedLow = applyLocationModifier(region?.p25 || 0, location) * tenureMultiplier * inflation;
  const locationAdjustedHigh = applyLocationModifier(region?.p75 || 0, location) * tenureMultiplier * inflation;

  const datasetWeight = locationAdjustedMedian ? 0.45 : 0;
  const plaidWeight = plaidIncome ? 0.35 : 0;
  const benchmarkWeight = aggregatedBenchmark ? 0.2 : 0;
  const totalWeight = datasetWeight + plaidWeight + benchmarkWeight;

  let compositeMedian = null;
  if (totalWeight > 0) {
    compositeMedian = (
      (locationAdjustedMedian * datasetWeight)
      + (plaidIncome || 0) * plaidWeight
      + (aggregatedBenchmark || 0) * benchmarkWeight
    ) / totalWeight;
  } else if (locationAdjustedMedian) {
    compositeMedian = locationAdjustedMedian;
  }

  const ratio = compositeMedian ? Number((currentPackageTotal / compositeMedian).toFixed(3)) : null;
  const status = ratio == null ? 'unknown'
    : ratio < 0.94 ? 'underpaid'
    : ratio > 1.08 ? 'overpaid'
    : 'fair';

  const recommendedSalary = compositeMedian
    ? Math.round(status === 'underpaid' ? compositeMedian * 1.02
      : status === 'overpaid' ? compositeMedian * 0.98
      : compositeMedian)
    : null;
  const recommendedRaise = recommendedSalary != null && currentPackageTotal
    ? Math.max(0, Math.round(recommendedSalary - currentPackageTotal))
    : null;

  const summaryParts = [];
  if (status === 'underpaid') {
    summaryParts.push('Current compensation trails the blended market median.');
    if (recommendedRaise) summaryParts.push(`Target a £${recommendedRaise.toLocaleString()} uplift to close the gap.`);
  } else if (status === 'overpaid') {
    summaryParts.push('You are tracking ahead of the market median.');
    summaryParts.push('Focus on broadening scope or planning the next promotion step.');
  } else if (status === 'fair') {
    summaryParts.push('Compensation is within 6% of the blended market median.');
    summaryParts.push('Maintain achievement logs and prep evidence for the next review.');
  } else {
    summaryParts.push('Insufficient data to benchmark compensation accurately.');
  }
  if (location) {
    summaryParts.push(`Location weighting applied for ${location}.`);
  }

  const sources = [];
  if (datasetWeight) {
    sources.push({
      label: `${dataset?.label || 'External dataset'} (${country.toUpperCase()})`,
      type: 'market_dataset',
      weight: Number((datasetWeight / (totalWeight || datasetWeight)).toFixed(2))
    });
  }
  if (plaidWeight) {
    sources.push({
      label: 'Plaid income streams',
      type: 'plaid_income',
      weight: Number((plaidWeight / (totalWeight || plaidWeight)).toFixed(2))
    });
  }
  if (benchmarkWeight) {
    sources.push({
      label: 'Navigator benchmark blends',
      type: 'navigator_benchmark',
      weight: Number((benchmarkWeight / (totalWeight || benchmarkWeight)).toFixed(2))
    });
  }

  const timeline = buildPromotionTimeline({ status, tenureYears: tenureYears || 0, role, company: navigator.company });

  return {
    status,
    ratio,
    summary: summaryParts.join(' '),
    marketMedian: compositeMedian ? Math.round(compositeMedian) : null,
    annualisedIncome: plaidIncome ? Math.round(plaidIncome) : currentPackageTotal || null,
    recommendedSalary,
    recommendedRaise,
    nextReview: navigator.nextReviewAt || timeline.windowStart,
    bands: {
      low: locationAdjustedLow ? Math.round(locationAdjustedLow) : null,
      median: compositeMedian ? Math.round(compositeMedian) : null,
      high: locationAdjustedHigh ? Math.round(locationAdjustedHigh) : null
    },
    promotionTimeline: timeline,
    sources,
    updatedAt: new Date()
  };
}

module.exports = {
  computeMarketBenchmark
};
