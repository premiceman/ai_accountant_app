'use strict';

const {
  ensureIsoDate,
  ensureIsoMonth,
  toMinorUnits,
  validatePayslipMetricsV1,
} = require('../../../../shared/v1/index.js');

const PAY_FREQUENCY_PERIODS = new Map([
  ['weekly', 52],
  ['fortnightly', 26],
  ['biweekly', 26],
  ['fourweekly', 13],
  ['four-weekly', 13],
  ['monthly', 12],
  ['quarterly', 4],
  ['annual', 1],
  ['annually', 1],
  ['yearly', 1],
]);

function parseNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const text = String(value).trim();
  if (!text) return null;

  let candidate = text;
  let negative = false;

  if (candidate.startsWith('(') && candidate.endsWith(')')) {
    negative = true;
    candidate = candidate.slice(1, -1);
  }

  const match = candidate.match(/[-+]?\d[\d,]*(?:\.\d+)?/);
  if (!match) return null;

  const cleaned = match[0].replace(/,/g, '');
  const num = Number(cleaned);
  if (!Number.isFinite(num)) return null;

  return negative ? -Math.abs(num) : num;
}

function normalisePayFrequency(raw) {
  if (!raw) return null;
  const text = String(raw).trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  if (PAY_FREQUENCY_PERIODS.has(lower)) {
    return { label: text, periods: PAY_FREQUENCY_PERIODS.get(lower) };
  }
  if (/four[\s-]?weekly/.test(lower)) return { label: text, periods: 13 };
  if (/bi[\s-]?weekly/.test(lower)) return { label: text, periods: 26 };
  if (/fortnight/.test(lower)) return { label: text, periods: 26 };
  if (/weekly/.test(lower)) return { label: text, periods: 52 };
  if (/monthly/.test(lower)) return { label: text, periods: 12 };
  if (/quarter/.test(lower)) return { label: text, periods: 4 };
  if (/annual|yearly/.test(lower)) return { label: text, periods: 1 };
  return { label: text, periods: null };
}

function normaliseLineItems(list, fallbackLabel, options = {}) {
  const { absolute = false } = options;
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => ({
      label: item?.label || item?.rawLabel || fallbackLabel,
      category: item?.category || item?.label || item?.rawLabel || fallbackLabel,
      amount: parseNumber(item?.amount ?? item?.amountPeriod ?? item?.value),
      amountYtd: parseNumber(item?.amountYtd ?? item?.amountYearToDate ?? item?.ytd),
    }))
    .map((item) => ({
      ...item,
      amount: item.amount != null && absolute ? Math.abs(item.amount) : item.amount,
      amountYtd: item.amountYtd != null && absolute ? Math.abs(item.amountYtd) : item.amountYtd,
    }))
    .filter((item) => item.amount != null);
}

function normaliseAllowances(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => ({
      label: item?.label || item?.rawLabel || 'Allowance',
      amount: parseNumber(item?.amount ?? item?.amountPeriod ?? item?.value),
      amountYtd: parseNumber(item?.amountYtd ?? item?.amountYearToDate ?? item?.ytd),
    }))
    .filter((item) => item.amount != null);
}

function derivePeriodMetadata(metadata = {}, metrics = {}) {
  const periodMeta = { ...(metadata.period || {}) };
  const periodStart = ensureIsoDate(metrics.periodStart ?? periodMeta.start);
  const periodEnd = ensureIsoDate(metrics.periodEnd ?? periodMeta.end);
  const payDate = ensureIsoDate(metrics.payDate ?? metadata.payDate ?? periodMeta.end ?? metadata.documentDate);
  const month = ensureIsoMonth(periodMeta.month ?? metadata.documentMonth ?? payDate);

  if (periodStart) periodMeta.start = periodStart;
  if (periodEnd) periodMeta.end = periodEnd;
  if (month) periodMeta.month = month;

  const nextMetadata = { ...metadata };
  if (payDate) nextMetadata.payDate = payDate;
  if (!nextMetadata.documentDate && payDate) nextMetadata.documentDate = payDate;
  if (!nextMetadata.documentMonth && month) nextMetadata.documentMonth = month;
  nextMetadata.period = periodMeta;

  return { payDate, periodStart, periodEnd, periodMonth: month, metadata: nextMetadata };
}

function normalisePayslip(insight) {
  const rawMetrics = insight.metrics || {};
  const rawMetadata = insight.metadata || {};

  const rawEarnings = Array.isArray(rawMetrics.earnings) && rawMetrics.earnings.length
    ? rawMetrics.earnings
    : rawMetadata.earnings;
  const rawDeductions = Array.isArray(rawMetrics.deductions) && rawMetrics.deductions.length
    ? rawMetrics.deductions
    : rawMetadata.deductions;
  const rawAllowances = Array.isArray(rawMetrics.allowances) && rawMetrics.allowances.length
    ? rawMetrics.allowances
    : rawMetadata.allowances;

  const earnings = normaliseLineItems(rawEarnings, 'Earning');
  const deductions = normaliseLineItems(rawDeductions, 'Deduction', { absolute: true });
  const allowances = normaliseAllowances(rawAllowances);

  const totals = rawMetrics.totals || rawMetadata.totals || {};

  const gross = parseNumber(
    rawMetrics.gross ??
      rawMetrics.grossPeriod ??
      totals.gross ??
      totals.grossPeriod ??
      rawMetadata.gross ??
      rawMetadata.grossPeriod
  );
  const grossYtd = parseNumber(
    rawMetrics.grossYtd ??
      totals.grossYtd ??
      rawMetadata.grossYtd ??
      rawMetadata.grossYearToDate ??
      totals.grossYearToDate
  );
  const net = parseNumber(
    rawMetrics.net ??
      rawMetrics.netPeriod ??
      totals.net ??
      totals.netPeriod ??
      rawMetadata.net ??
      rawMetadata.netPeriod
  );
  const netYtd = parseNumber(
    rawMetrics.netYtd ??
      totals.netYtd ??
      totals.netYearToDate ??
      rawMetadata.netYtd ??
      rawMetadata.netYearToDate
  );

  const deductionLookup = new Map(
    deductions.map((item) => [String(item.category || item.label || '').toLowerCase(), item.amount])
  );

  const tax = parseNumber(
    rawMetrics.tax ??
      rawMetrics.incomeTax ??
      totals.tax ??
      totals.incomeTax ??
      rawMetadata.tax ??
      rawMetadata.incomeTax ??
      deductionLookup.get('income_tax') ??
      deductionLookup.get('income tax') ??
      deductionLookup.get('tax')
  );
  const ni = parseNumber(
    rawMetrics.ni ??
      rawMetrics.nationalInsurance ??
      totals.ni ??
      totals.nationalInsurance ??
      rawMetadata.ni ??
      rawMetadata.nationalInsurance ??
      deductionLookup.get('national_insurance') ??
      deductionLookup.get('national insurance')
  );
  const pension = parseNumber(
    rawMetrics.pension ??
      totals.pension ??
      rawMetadata.pension ??
      rawMetadata.pensionContribution ??
      deductionLookup.get('pension_employee') ??
      deductionLookup.get('pension contribution ae') ??
      deductionLookup.get('pension')
  );
  const studentLoan = parseNumber(
    rawMetrics.studentLoan ??
      rawMetrics.studentLoanRepayment ??
      totals.studentLoan ??
      rawMetadata.studentLoan ??
      deductionLookup.get('student_loan') ??
      deductionLookup.get('student loan')
  );

  const deductionsTotal = deductions.reduce((acc, item) => acc + (item.amount || 0), 0);
  const totalDeductions =
    parseNumber(
      rawMetrics.totalDeductions ??
        totals.totalDeductions ??
        rawMetadata.totalDeductions ??
        totals.deductionsTotal ??
        rawMetadata.deductionsTotal
    ) ?? (deductions.length ? deductionsTotal : null);

  const payFrequencyRaw =
    rawMetrics.payFrequency ??
    rawMetadata.payFrequency ??
    rawMetadata.period?.payFrequency ??
    totals.payFrequency;
  const frequency = normalisePayFrequency(payFrequencyRaw);
  const annualisedGross =
    gross != null && frequency?.periods
      ? gross * frequency.periods
      : parseNumber(rawMetrics.annualisedGross ?? totals.annualisedGross ?? rawMetadata.annualisedGross);

  const takeHomePercent =
    gross
      ? (net ?? 0) / gross
      : parseNumber(rawMetrics.takeHomePercent ?? totals.takeHomePercent ?? rawMetadata.takeHomePercent);
  const effectiveMarginalRate =
    gross
      ? (totalDeductions ?? 0) / gross
      : parseNumber(
          rawMetrics.effectiveMarginalRate ??
            totals.effectiveMarginalRate ??
            rawMetadata.effectiveMarginalRate
        );

  const { payDate, periodStart, periodEnd, periodMonth, metadata } = derivePeriodMetadata(rawMetadata, {
    periodStart: rawMetrics.periodStart ?? rawMetadata.period?.start,
    periodEnd: rawMetrics.periodEnd ?? rawMetadata.period?.end,
    payDate: rawMetrics.payDate ?? rawMetadata.payDate ?? rawMetadata.documentDate,
  });

  const metrics = {
    ...rawMetrics,
    gross,
    grossYtd,
    net,
    netYtd,
    tax,
    ni,
    nationalInsurance: ni,
    pension,
    studentLoan,
    totalDeductions,
    annualisedGross,
    takeHomePercent: takeHomePercent != null && Number.isFinite(takeHomePercent) ? takeHomePercent : null,
    effectiveMarginalRate:
      effectiveMarginalRate != null && Number.isFinite(effectiveMarginalRate) ? effectiveMarginalRate : null,
    payFrequency: frequency?.label ?? payFrequencyRaw ?? null,
    taxCode: rawMetrics.taxCode ?? rawMetadata.taxCode ?? null,
    payDate: payDate ?? null,
    periodStart: periodStart ?? null,
    periodEnd: periodEnd ?? null,
    earnings,
    deductions,
    allowances,
  };

  const fallbackDate = payDate ?? periodEnd ?? periodStart ?? metadata.documentDate ?? new Date().toISOString().slice(0, 10);
  const month = periodMonth ?? ensureIsoMonth(fallbackDate);
  const period = {
    start: periodStart ?? fallbackDate,
    end: periodEnd ?? fallbackDate,
    month,
  };

  const employerRecord = rawMetadata.employer || {};
  const employerFromObject =
    employerRecord && typeof employerRecord === 'object' && typeof employerRecord.name === 'string'
      ? employerRecord.name
      : null;
  const employerName = employerFromObject || rawMetadata.employerName || rawMetrics.employerName || null;

  const metricsV1 = {
    payDate: payDate ?? fallbackDate,
    period,
    employer: employerName ? { name: employerName } : null,
    grossMinor: toMinorUnits(gross),
    netMinor: toMinorUnits(net),
    taxMinor: toMinorUnits(tax),
    nationalInsuranceMinor: toMinorUnits(ni),
    pensionMinor: toMinorUnits(pension),
    studentLoanMinor: toMinorUnits(studentLoan),
    taxCode: metrics.taxCode,
  };

  if (!validatePayslipMetricsV1(metricsV1)) {
    console.warn('[insightNormaliser] payslip metricsV1 failed validation', validatePayslipMetricsV1.errors);
    return { metrics, metricsV1: null, metadata };
  }

  return { metrics, metricsV1, metadata };
}

function normaliseDocumentInsight(insight = {}) {
  const baseKey = insight.baseKey || insight.catalogueKey || insight.key || null;
  if (!baseKey) {
    return {
      metrics: { ...(insight.metrics || {}) },
      metricsV1: insight.metricsV1 || null,
      metadata: { ...(insight.metadata || {}) },
    };
  }

  if (baseKey === 'payslip') {
    return normalisePayslip(insight);
  }

  return {
    metrics: { ...(insight.metrics || {}) },
    metricsV1: insight.metricsV1 || null,
    metadata: { ...(insight.metadata || {}) },
  };
}

module.exports = { normaliseDocumentInsight };
