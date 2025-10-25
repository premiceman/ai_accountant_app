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
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return num;
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

function normaliseLineItems(list, fallbackLabel) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => ({
      label: item?.label || item?.rawLabel || fallbackLabel,
      category: item?.category || item?.label || item?.rawLabel || fallbackLabel,
      amount: parseNumber(item?.amount ?? item?.amountPeriod ?? item?.value),
      amountYtd: parseNumber(item?.amountYtd ?? item?.amountYearToDate ?? item?.ytd),
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

  const earnings = normaliseLineItems(rawMetrics.earnings, 'Earning');
  const deductions = normaliseLineItems(rawMetrics.deductions, 'Deduction');
  const allowances = normaliseAllowances(rawMetrics.allowances);

  const gross = parseNumber(rawMetrics.gross ?? rawMetrics.grossPeriod ?? rawMetrics.totals?.grossPeriod);
  const grossYtd = parseNumber(rawMetrics.grossYtd ?? rawMetrics.totals?.grossYtd);
  const net = parseNumber(rawMetrics.net ?? rawMetrics.netPeriod ?? rawMetrics.totals?.netPeriod);
  const netYtd = parseNumber(rawMetrics.netYtd ?? rawMetrics.totals?.netYtd);
  const tax = parseNumber(rawMetrics.tax ?? rawMetrics.incomeTax);
  const ni = parseNumber(rawMetrics.ni ?? rawMetrics.nationalInsurance);
  const pension = parseNumber(rawMetrics.pension);
  const studentLoan = parseNumber(rawMetrics.studentLoan ?? rawMetrics.studentLoanRepayment);

  const deductionsTotal = deductions.reduce((acc, item) => acc + (item.amount || 0), 0);
  const totalDeductions = parseNumber(rawMetrics.totalDeductions) ?? (deductions.length ? deductionsTotal : null);

  const payFrequencyRaw = rawMetrics.payFrequency ?? rawMetadata.payFrequency;
  const frequency = normalisePayFrequency(payFrequencyRaw);
  const annualisedGross = gross != null && frequency?.periods ? gross * frequency.periods : parseNumber(rawMetrics.annualisedGross);

  const takeHomePercent = gross ? (net ?? 0) / gross : parseNumber(rawMetrics.takeHomePercent);
  const effectiveMarginalRate = gross ? (totalDeductions ?? 0) / gross : parseNumber(rawMetrics.effectiveMarginalRate);

  const { payDate, periodStart, periodEnd, periodMonth, metadata } = derivePeriodMetadata(rawMetadata, {
    periodStart: rawMetrics.periodStart,
    periodEnd: rawMetrics.periodEnd,
    payDate: rawMetrics.payDate,
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

  const metricsV1 = {
    payDate: payDate ?? fallbackDate,
    period,
    employer: rawMetadata.employerName ?? rawMetrics.employerName ?? null,
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
