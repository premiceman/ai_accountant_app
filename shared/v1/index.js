// NOTE: Phase-3 — Frontend uses /api/analytics/v1, staged loader on dashboards, Ajv strict. Rollback via flags.
/**
 * ## Intent (Phase-1 only — additive, no breaking changes)
 *
 * Fix inconsistent dashboards by introducing a tiny, normalised v1 data layer alongside
 * today’s legacy fields. Worker dual-writes new normalised shapes, analytics prefers v1 with
 * legacy fallbacks, and Ajv validators warn without breaking existing flows.
 */

let AjvCtor;
try {
  // eslint-disable-next-line global-require
  AjvCtor = require('ajv');
} catch (error) {
  try {
    // eslint-disable-next-line global-require
    AjvCtor = require('../../backend/node_modules/ajv');
  } catch (innerError) {
    AjvCtor = require('../internal/miniAjv.js');
  }
}

const { featureFlags } = require('../config/featureFlags.js');

const canonicalCategories = Object.freeze(require('../canonicalCategories.json'));
const payslipMetricsSchema = require('../schemas/payslipMetricsV1.json');
const transactionSchema = require('../schemas/transactionV1.json');
const statementMetricsSchema = require('../schemas/statementMetricsV1.json');
const analyticsResponseSchemas = require('../schemas/analyticsV1Responses.js');

const ajv = new AjvCtor({
  allErrors: true,
  strict: featureFlags.enableAjvStrict,
  messages: true,
  allowUnionTypes: true,
  removeAdditional: featureFlags.enableAjvStrict ? false : undefined,
});

const validatePayslipMetricsV1 = ajv.compile(payslipMetricsSchema);
const validateTransactionV1 = ajv.compile(transactionSchema);
const validateStatementMetricsV1 = ajv.compile(statementMetricsSchema);
const validateDashboardSummaryV1 = ajv.compile(analyticsResponseSchemas.dashboardSummaryV1);
const validateAnalyticsCategoriesV1 = ajv.compile(analyticsResponseSchemas.categoriesV1);
const validateAnalyticsLargestExpensesV1 = ajv.compile(analyticsResponseSchemas.largestExpensesV1);
const validateAnalyticsAccountsV1 = ajv.compile(analyticsResponseSchemas.accountsV1);
const validateAnalyticsTimeseriesV1 = ajv.compile(analyticsResponseSchemas.timeseriesV1);

const canonicalCategoryMap = new Map(
  canonicalCategories.map((category) => [simplifyCategory(category), category])
);

const synonymMap = new Map(
  [
    ['salary', 'Income'],
    ['wages', 'Income'],
    ['pay', 'Income'],
    ['food', 'Groceries'],
    ['grocery', 'Groceries'],
    ['restaurant', 'EatingOut'],
    ['dining', 'EatingOut'],
    ['electric', 'Utilities'],
    ['gas', 'Utilities'],
    ['mortgage', 'RentMortgage'],
    ['rent', 'RentMortgage'],
    ['uber', 'Transport'],
    ['fuel', 'Fuel'],
    ['petrol', 'Fuel'],
    ['tv', 'Entertainment'],
    ['subscription', 'Subscriptions'],
    ['netflix', 'Entertainment'],
    ['doctor', 'Health'],
    ['dentist', 'Health'],
    ['insurance', 'Insurance'],
    ['school', 'Education'],
    ['tuition', 'Education'],
    ['holiday', 'Travel'],
    ['flight', 'Travel'],
    ['cash', 'Cash'],
    ['transfer', 'Transfers'],
    ['loan', 'DebtRepayment'],
    ['fee', 'Fees'],
    ['gift', 'GiftsDonations'],
    ['donation', 'GiftsDonations'],
    ['child', 'Childcare'],
    ['nursery', 'Childcare'],
    ['home', 'Home'],
    ['repair', 'Home'],
    ['shop', 'Shopping'],
  ].map(([key, value]) => [key, value])
);

function simplifyCategory(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

function normaliseCategory(raw) {
  const simplified = simplifyCategory(raw);
  if (!simplified) {
    return 'Misc';
  }
  const direct = canonicalCategoryMap.get(simplified);
  if (direct) {
    return direct;
  }
  const synonym = synonymMap.get(simplified);
  if (synonym) {
    return synonym;
  }
  return 'Misc';
}

function parseMonthYear(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const matchSlash = raw.match(/^(\d{1,2})[\/-](\d{4})$/);
  if (matchSlash) {
    const monthNum = Number(matchSlash[1]);
    if (monthNum >= 1 && monthNum <= 12) {
      return {
        year: matchSlash[2],
        month: String(monthNum).padStart(2, '0'),
      };
    }
  }

  const matchReverse = raw.match(/^(\d{4})[\/-](\d{1,2})$/);
  if (matchReverse) {
    const monthNum = Number(matchReverse[2]);
    if (monthNum >= 1 && monthNum <= 12) {
      return {
        year: matchReverse[1],
        month: String(monthNum).padStart(2, '0'),
      };
    }
  }

  const matchSpace = raw.match(/^(\d{1,2})\s+(\d{4})$/);
  if (matchSpace) {
    const monthNum = Number(matchSpace[1]);
    if (monthNum >= 1 && monthNum <= 12) {
      return {
        year: matchSpace[2],
        month: String(monthNum).padStart(2, '0'),
      };
    }
  }

  return null;
}

function ensureIsoDate(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const monthYear = parseMonthYear(value);
  if (monthYear) {
    return `${monthYear.year}-${monthYear.month}-01`;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function ensureIsoMonth(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}$/.test(value)) {
    return value;
  }
  const monthYear = parseMonthYear(value);
  if (monthYear) {
    return `${monthYear.year}-${monthYear.month}`;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function toMinorUnits(major) {
  if (major == null || major === '') return 0;
  const value = Number(major);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

function toMajorUnits(minor) {
  if (minor == null || minor === '') return 0;
  const value = Number(minor);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value) / 100;
}

function normaliseCurrency(value) {
  const upper = String(value || '').trim().toUpperCase();
  return upper || 'GBP';
}

module.exports = {
  canonicalCategories,
  analyticsResponseSchemas,
  normaliseCategory,
  ensureIsoDate,
  ensureIsoMonth,
  toMinorUnits,
  toMajorUnits,
  normaliseCurrency,
  validatePayslipMetricsV1,
  validateTransactionV1,
  validateStatementMetricsV1,
  validateDashboardSummaryV1,
  validateAnalyticsCategoriesV1,
  validateAnalyticsLargestExpensesV1,
  validateAnalyticsAccountsV1,
  validateAnalyticsTimeseriesV1,
};
