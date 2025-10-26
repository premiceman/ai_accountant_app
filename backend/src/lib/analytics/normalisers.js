'use strict';

const { createLogger } = require('../logger');
const {
  ensureIsoDate,
  ensureIsoMonth,
  normaliseCategory,
  normaliseCurrency,
  toMinorUnits,
  validatePayslipMetricsV1,
  validateStatementMetricsV1,
  validateTransactionV1,
} = require('../../../../shared/v1/index.js');
const { normalizeInsightV1 } = require('../../../../shared/lib/insights/normalizeV1.js');
const { featureFlags } = require('../featureFlags.js');

const logger = createLogger({ name: 'analytics-normalisers', level: process.env.LOG_LEVEL ?? 'info' });

const STATEMENT_TYPES = new Set([
  'current_account_statement',
  'savings_account_statement',
  'isa_statement',
  'investment_statement',
  'pension_statement',
]);

const PAY_FREQUENCY_MULTIPLIERS = new Map([
  ['weekly', 52],
  ['fortnightly', 26],
  ['biweekly', 26],
  ['fourweekly', 13],
  ['monthly', 12],
  ['quarterly', 4],
  ['annual', 1],
  ['annually', 1],
  ['yearly', 1],
]);

function coerceNumber(value) {
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
  if (PAY_FREQUENCY_MULTIPLIERS.has(lower)) {
    return { label: text, periods: PAY_FREQUENCY_MULTIPLIERS.get(lower) || null };
  }
  if (/four[-\s]?weekly/.test(lower)) return { label: 'Four-weekly', periods: 13 };
  if (/bi[-\s]?weekly/.test(lower)) return { label: 'Bi-weekly', periods: 26 };
  if (/fortnight/.test(lower)) return { label: 'Fortnightly', periods: 26 };
  if (/weekly/.test(lower)) return { label: 'Weekly', periods: 52 };
  if (/monthly/.test(lower)) return { label: 'Monthly', periods: 12 };
  if (/quarter/.test(lower)) return { label: 'Quarterly', periods: 4 };
  if (/annual|yearly/.test(lower)) return { label: 'Annual', periods: 1 };
  return { label: text, periods: null };
}

function parseStructuredPayslip(payslip, metadata, fallbackDate, documentMonth) {
  if (!payslip || typeof payslip !== 'object') return null;

  const totals = payslip.totals || {};
  const gross = coerceNumber(totals.grossPeriod);
  const grossYtd = coerceNumber(totals.grossYtd);
  const net = coerceNumber(totals.netPeriod);
  const netYtd = coerceNumber(totals.netYtd);

  const earnings = Array.isArray(payslip.earnings)
    ? payslip.earnings
        .map((item) => ({
          label: item.rawLabel || item.label || item.category || 'Earning',
          category: item.category || item.label || item.rawLabel || 'Earning',
          amount: coerceNumber(item.amountPeriod),
          amountYtd: coerceNumber(item.amountYtd),
        }))
        .filter((item) => item.amount != null)
    : [];

  const deductions = Array.isArray(payslip.deductions)
    ? payslip.deductions
        .map((item) => ({
          label: item.rawLabel || item.label || item.category || 'Deduction',
          category: item.category || item.label || item.rawLabel || 'Deduction',
          amount: coerceNumber(item.amountPeriod),
          amountYtd: coerceNumber(item.amountYtd),
        }))
        .filter((item) => item.amount != null)
    : [];

  const findDeduction = (slug) => {
    const exact = deductions.find((item) => String(item.category || '').toLowerCase() === slug);
    if (exact) return exact.amount;
    const fuzzy = deductions.find((item) => String(item.label || '').toLowerCase().includes(slug.replace('_', ' ')));
    return fuzzy ? fuzzy.amount : null;
  };

  const tax = findDeduction('income_tax');
  const nationalInsurance = findDeduction('national_insurance');
  const pension = findDeduction('pension') ?? coerceNumber(payslip.employer?.employersPensionThisPeriod);
  const studentLoan = findDeduction('student_loan');

  const totalDeductions = deductions.reduce((acc, item) => acc + (item.amount || 0), 0);

  const period = payslip.period || {};
  const periodStart = ensureIsoDate(period.start) ?? ensureIsoDate(period.startDate);
  const periodEnd = ensureIsoDate(period.end) ?? ensureIsoDate(period.endDate);
  const payDate = ensureIsoDate(periodEnd ?? period.payDate ?? period.Date) ?? fallbackDate;
  const month = ensureIsoMonth(period.month) ?? ensureIsoMonth(periodEnd ?? documentMonth ?? payDate) ?? payDate.slice(0, 7);

  const frequency = normalisePayFrequency(period.payFrequency || metadata.payFrequency);
  const annualisedGross = gross != null && frequency?.periods ? gross * frequency.periods : null;
  const takeHomePercent = gross ? (net ?? 0) / gross : null;
  const effectiveMarginalRate = gross ? (totalDeductions || 0) / gross : null;

  const metricsV1 = {
    payDate: payDate ?? fallbackDate,
    period: {
      start: periodStart ?? payDate ?? fallbackDate,
      end: periodEnd ?? payDate ?? fallbackDate,
      month,
    },
    employer: payslip.employer?.name || metadata.employerName || null,
    grossMinor: toMinorUnits(gross),
    netMinor: toMinorUnits(net),
    taxMinor: toMinorUnits(tax),
    nationalInsuranceMinor: toMinorUnits(nationalInsurance),
    pensionMinor: toMinorUnits(pension),
    studentLoanMinor: toMinorUnits(studentLoan),
    taxCode: payslip.employee?.taxCode || metadata.taxCode || null,
  };

  const legacyPatch = {
    gross,
    grossYtd,
    net,
    netYtd,
    tax,
    ni: nationalInsurance,
    nationalInsurance,
    pension,
    studentLoan,
    totalDeductions,
    annualisedGross,
    takeHomePercent: takeHomePercent != null && Number.isFinite(takeHomePercent) ? takeHomePercent : null,
    effectiveMarginalRate: effectiveMarginalRate != null && Number.isFinite(effectiveMarginalRate)
      ? effectiveMarginalRate
      : null,
    payFrequency: frequency?.label || metadata.payFrequency || null,
    taxCode: metricsV1.taxCode,
    payDate,
    periodStart,
    periodEnd,
    earnings,
    deductions,
    allowances: Array.isArray(payslip.allowances)
      ? payslip.allowances
          .map((item) => ({
            label: item.label || item.rawLabel || 'Allowance',
            amount: coerceNumber(item.amount),
          }))
          .filter((item) => item.amount != null)
      : [],
    notes: Array.isArray(payslip.meta?.notes)
      ? payslip.meta.notes.filter(Boolean).map((note) => String(note))
      : [],
  };

  return { metricsV1, legacyPatch, metadataPatch: { period: { start: periodStart, end: periodEnd, month } } };
}

function parseStructuredStatement(statement, metadata, fallbackDate, currency) {
  if (!statement || typeof statement !== 'object') return null;

  const institution = statement.institution || {};
  const account = statement.account || {};
  const statementPeriod = statement.statement?.period || statement.period || {};

  const periodStart = ensureIsoDate(statementPeriod.startDate ?? statementPeriod.start);
  const periodEnd = ensureIsoDate(statementPeriod.endDate ?? statementPeriod.end);
  const month = ensureIsoMonth(statementPeriod.month)
    ?? ensureIsoMonth(periodEnd ?? periodStart ?? metadata.period?.month)
    ?? ensureIsoMonth(fallbackDate)
    ?? fallbackDate.slice(0, 7);

  const txSource = Array.isArray(statement.transactions) ? statement.transactions : [];
  const transactionsV1 = [];
  const legacyTransactions = [];
  const categories = new Map();
  let incomeTotal = 0;
  let spendTotal = 0;
  let transferCount = 0;

  txSource.forEach((tx, index) => {
    const moneyIn = coerceNumber(tx.moneyIn);
    const moneyOut = coerceNumber(tx.moneyOut);
    let amount = null;
    if (moneyIn != null || moneyOut != null) {
      amount = (moneyIn || 0) - (moneyOut || 0);
    } else {
      amount = coerceNumber(tx.amount);
    }
    if (amount == null) return;

    const direction = amount < 0 ? 'outflow' : 'inflow';
    const absAmount = Math.abs(amount);
    const amountMinor = toMinorUnits(absAmount);
    const signedMinor = direction === 'outflow' ? -amountMinor : amountMinor;
    const date = ensureIsoDate(tx.date ?? tx.postedAt ?? tx.transactionDate) ?? periodEnd ?? periodStart ?? fallbackDate;
    const rawCategory = tx.category || tx.transactionType || tx.paymentMethod || (direction === 'outflow' ? 'Spend' : 'Income');
    const category = normaliseCategory(rawCategory);
    const description = String(
      tx.description || tx.reference || tx.counterparty || rawCategory || 'Transaction'
    ).trim();
    const accountId = account.accountNumber || account.accountNumberMasked || metadata.accountId || null;
    const accountName = account.holderName || metadata.accountName || account.type || null;

    transactionsV1.push({
      id: tx.id ? String(tx.id) : `structured-${index}`,
      date,
      description,
      amountMinor: signedMinor,
      direction,
      category,
      accountId,
      accountName,
      currency,
    });

    const signedMajor = direction === 'outflow' ? -absAmount : absAmount;
    legacyTransactions.push({
      id: tx.id ? String(tx.id) : `structured-${index}`,
      date,
      description,
      amount: signedMajor,
      direction,
      category,
      accountId,
      accountName,
      transfer: category === 'Transfers',
    });

    if (direction === 'outflow') spendTotal += absAmount;
    else incomeTotal += absAmount;

    const entry = categories.get(category) || { category, inflow: 0, outflow: 0 };
    if (direction === 'outflow') entry.outflow += absAmount;
    else entry.inflow += absAmount;
    categories.set(category, entry);
    if (category === 'Transfers') transferCount += 1;
  });

  const categoryList = Array.from(categories.values()).sort(
    (a, b) => (b.outflow || b.inflow) - (a.outflow || a.inflow)
  );
  const totalOutflow = categoryList.reduce((acc, item) => acc + (item.outflow || 0), 0);
  const spendingCanteorgies = categoryList.map((item) => ({
    label: item.category,
    category: item.category,
    amount: item.outflow || item.inflow || 0,
    outflow: item.outflow || 0,
    inflow: item.inflow || 0,
    share: totalOutflow ? (item.outflow || 0) / totalOutflow : 0,
  }));

  const largestExpenses = legacyTransactions
    .filter((tx) => tx.direction === 'outflow')
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, 5)
    .map((tx) => ({
      description: tx.description,
      amount: Math.abs(tx.amount),
      category: tx.category,
      date: tx.date,
      accountName: tx.accountName,
    }));

  const topCategories = categoryList
    .filter((item) => item.outflow)
    .slice(0, 5)
    .map((item) => ({
      category: item.category,
      outflow: item.outflow,
      inflow: item.inflow,
    }));

  const roundedIncome = Math.round(incomeTotal * 100) / 100;
  const roundedSpend = Math.round(spendTotal * 100) / 100;

  const metricsV1 = {
    period: {
      start: periodStart ?? periodEnd ?? fallbackDate,
      end: periodEnd ?? periodStart ?? fallbackDate,
      month,
    },
    inflowsMinor: toMinorUnits(roundedIncome),
    outflowsMinor: toMinorUnits(roundedSpend),
    netMinor: toMinorUnits(roundedIncome - roundedSpend),
  };

  const legacyPatch = {
    income: roundedIncome,
    spend: roundedSpend,
    totals: {
      income: roundedIncome,
      spend: roundedSpend,
      net: Math.round((roundedIncome - roundedSpend) * 100) / 100,
    },
    categories: categoryList,
    topCategories,
    largestExpenses,
    spendingCanteorgies,
    accounts: [
      {
        accountId: account.accountNumber || account.accountNumberMasked || metadata.accountId || null,
        accountName: account.holderName || account.accountNumberMasked || metadata.accountName || 'Account',
        bankName: institution.name || metadata.bankName || null,
        accountType: account.type || metadata.accountType || null,
        totals: {
          income: roundedIncome,
          spend: roundedSpend,
        },
      },
    ],
    transferCount,
  };

  const metadataPatch = {
    accountId: account.accountNumber || account.accountNumberMasked || metadata.accountId || null,
    accountName: account.holderName || metadata.accountName || null,
    bankName: institution.name || metadata.bankName || null,
    accountType: account.type || metadata.accountType || null,
    period: {
      start: periodStart,
      end: periodEnd,
      month,
    },
  };

  return { metricsV1, legacyPatch, transactionsV1, legacyTransactions, metadataPatch };
}

function normaliseTransactionRecord(source, fallbackDate, currency, prefix, index, metadata, base) {
  const rawId = source.id ?? source.transactionId ?? base?.id ?? `${prefix}-${index}`;
  const isoDate =
    ensureIsoDate(source.date ?? source.postedAt ?? base?.date ?? fallbackDate) ?? fallbackDate;
  const baseAmountMinor =
    typeof source.amountMinor === 'number'
      ? Math.round(source.amountMinor)
      : toMinorUnits(source.amount ?? base?.amountMinor ?? 0);
  const rawDirection = String(source.direction ?? base?.direction ?? '').toLowerCase();
  let direction = baseAmountMinor < 0 ? 'outflow' : 'inflow';
  if (rawDirection === 'inflow' || rawDirection === 'outflow') {
    direction = rawDirection;
  }
  let amountMinor = baseAmountMinor;
  if (direction === 'outflow' && amountMinor > 0) {
    amountMinor = -Math.abs(amountMinor);
  } else if (direction === 'inflow' && amountMinor < 0) {
    amountMinor = Math.abs(amountMinor);
  }
  const candidate = {
    id: String(rawId || `${prefix}-${index}`),
    date: isoDate,
    description: String(source.description ?? source.name ?? base?.description ?? ''),
    amountMinor,
    direction,
    category: normaliseCategory(source.category ?? source.normalisedCategory ?? base?.category),
    accountId:
      typeof source.accountId === 'string'
        ? source.accountId
        : typeof metadata.accountId === 'string'
        ? metadata.accountId
        : base?.accountId ?? null,
    accountName:
      typeof source.accountName === 'string'
        ? source.accountName
        : typeof metadata.accountName === 'string'
        ? metadata.accountName
        : base?.accountName ?? null,
    currency,
  };
  if (!validateTransactionV1(candidate)) {
    const context = {
      id: candidate.id,
      errors: validateTransactionV1.errors,
    };
    const level = featureFlags.strictMetricsV1 ? 'error' : 'warn';
    logger[level](context, 'Transaction normalisation failed v1 validation');
    return base ?? null;
  }
  return candidate;
}

function buildDocumentMonth(value) {
  const month = ensureIsoMonth(value);
  if (month) return month;
  const asDate = ensureIsoDate(value);
  if (!asDate) return null;
  return asDate.slice(0, 7);
}

function preferV1(insight) {
  let metadata = { ...(insight.metadata ?? {}) };
  let legacyMetrics = { ...(insight.metrics ?? {}) };
  let legacyTransactions = Array.isArray(insight.transactions)
    ? insight.transactions.map((tx) => ({ ...(tx || {}) }))
    : [];
  const currency = normaliseCurrency(insight.currency ?? metadata.currency ?? 'GBP');
  const fallbackDate =
    insight.documentDateV1 ??
    ensureIsoDate(insight.documentDate ?? metadata.documentDate) ??
    ensureIsoDate(metadata.payDate) ??
    new Date().toISOString().slice(0, 10);
  const documentMonth = insight.documentMonth ?? buildDocumentMonth(metadata.documentMonth ?? fallbackDate);

  let metricsV1 = null;
  const transactionsV1 = [];

  if (insight.catalogueKey === 'payslip') {
    const normalised = normalizeInsightV1({ ...insight, insightType: 'payslip' });
    if (normalised?.metricsV1) {
      metricsV1 = { ...(normalised.metricsV1 ?? {}) };
      if (!validatePayslipMetricsV1(metricsV1)) {
        const level = featureFlags.strictMetricsV1 ? 'error' : 'warn';
        logger[level](
          { fileId: insight.fileId, errors: validatePayslipMetricsV1.errors },
          'Payslip metricsV1 validation failed; continuing with best-effort values'
        );
      }
    }
    if (!metricsV1) {
      const existing = insight.metricsV1;
      const structuredCandidates = [];
      if (existing && typeof existing === 'object') structuredCandidates.push(existing);
      if (metadata.standardised && typeof metadata.standardised === 'object') structuredCandidates.push(metadata.standardised);
      if (metadata.standardized && typeof metadata.standardized === 'object') structuredCandidates.push(metadata.standardized);
      if (metadata.payslip && typeof metadata.payslip === 'object') structuredCandidates.push(metadata.payslip);
      if (legacyMetrics.document && typeof legacyMetrics.document === 'object') structuredCandidates.push(legacyMetrics.document);

      let structured = null;
      for (const candidate of structuredCandidates) {
        structured = parseStructuredPayslip(candidate, metadata, fallbackDate, documentMonth);
        if (structured) break;
      }

      if (structured) {
        metricsV1 = structured.metricsV1;
        legacyMetrics = { ...legacyMetrics, ...structured.legacyPatch };
        if (structured.metadataPatch) {
          metadata = { ...metadata, ...structured.metadataPatch };
          if (structured.metadataPatch.period || metadata.period) {
            metadata.period = {
              ...(metadata.period || {}),
              ...(structured.metadataPatch.period || {}),
            };
          }
        }
      }

      if (!metricsV1) {
        const payDate = ensureIsoDate(legacyMetrics.payDate ?? metadata.payDate ?? fallbackDate) ?? fallbackDate;
        const periodMeta = legacyMetrics.period ?? metadata.period ?? {};
        const employerRecord = (metadata.employer ?? {}) || {};
        const employerName =
          typeof employerRecord.name === 'string'
            ? employerRecord.name
            : typeof metadata.employerName === 'string'
            ? metadata.employerName
            : typeof legacyMetrics.employerName === 'string'
            ? legacyMetrics.employerName
            : null;
        metricsV1 = {
          payDate,
          period: {
            start: ensureIsoDate(periodMeta.start) ?? payDate,
            end: ensureIsoDate(periodMeta.end) ?? payDate,
            month:
              ensureIsoMonth(periodMeta.month ?? periodMeta.Date ?? documentMonth) ??
              payDate.slice(0, 7),
          },
          employer: employerName ? { name: employerName } : null,
          grossMinor: toMinorUnits(legacyMetrics.gross),
          netMinor: toMinorUnits(legacyMetrics.net),
          taxMinor: toMinorUnits(legacyMetrics.tax),
          nationalInsuranceMinor: toMinorUnits(legacyMetrics.ni ?? legacyMetrics.nationalInsurance),
          pensionMinor: toMinorUnits(legacyMetrics.pension),
          studentLoanMinor: toMinorUnits(legacyMetrics.studentLoan),
          taxCode: typeof legacyMetrics.taxCode === 'string' ? legacyMetrics.taxCode : null,
        };
        if (!validatePayslipMetricsV1(metricsV1)) {
          const level = featureFlags.strictMetricsV1 ? 'error' : 'warn';
          logger[level](
            { fileId: insight.fileId, errors: validatePayslipMetricsV1.errors },
            'Legacy payslip mapping failed validation'
          );
        }
      }
    }
  } else if (STATEMENT_TYPES.has(insight.catalogueKey)) {
    const existingTx = Array.isArray(insight.transactionsV1) ? insight.transactionsV1 : [];
    existingTx.forEach((tx, index) => {
      const normalised = normaliseTransactionRecord(tx ?? {}, fallbackDate, currency, 'v1', index, metadata);
      if (normalised) transactionsV1.push(normalised);
    });

    const existingMetrics = insight.metricsV1;
    let structured = null;
    const normalised = normalizeInsightV1({
      ...insight,
      insightType: insight.catalogueKey,
      transactionsV1: existingTx,
    });
    if (normalised?.metricsV1) {
      metricsV1 = { ...(normalised.metricsV1 ?? {}) };
      if (!validateStatementMetricsV1(metricsV1)) {
        const level = featureFlags.strictMetricsV1 ? 'error' : 'warn';
        logger[level](
          { fileId: insight.fileId, errors: validateStatementMetricsV1.errors },
          'Statement metricsV1 validation failed; continuing with best-effort values'
        );
      }
    }
    if (!metricsV1 && existingMetrics && validateStatementMetricsV1(existingMetrics)) {
      metricsV1 = { ...existingMetrics };
    }
    if (!metricsV1) {
      const structuredCandidates = [];
      if (existingMetrics && typeof existingMetrics === 'object') structuredCandidates.push(existingMetrics);
      if (metadata.standardised && typeof metadata.standardised === 'object') structuredCandidates.push(metadata.standardised);
      if (metadata.standardized && typeof metadata.standardized === 'object') structuredCandidates.push(metadata.standardized);
      if (metadata.statement && typeof metadata.statement === 'object') structuredCandidates.push(metadata.statement);
      if (legacyMetrics.document && typeof legacyMetrics.document === 'object') structuredCandidates.push(legacyMetrics.document);

      for (const candidate of structuredCandidates) {
        structured = parseStructuredStatement(candidate, metadata, fallbackDate, currency);
        if (structured) break;
      }

      if (structured) {
        metricsV1 = structured.metricsV1;
        legacyMetrics = { ...legacyMetrics, ...structured.legacyPatch };
        if (structured.metadataPatch) {
          metadata = { ...metadata, ...structured.metadataPatch };
          if (structured.metadataPatch.period || metadata.period) {
            metadata.period = {
              ...(metadata.period || {}),
              ...(structured.metadataPatch.period || {}),
            };
          }
        }
        if (Array.isArray(structured.transactionsV1)) {
          structured.transactionsV1.forEach((tx, index) => {
            const normalised = normaliseTransactionRecord(tx ?? {}, fallbackDate, currency, 'structured', index, metadata);
            if (normalised) transactionsV1.push(normalised);
          });
        }
        if (Array.isArray(structured.legacyTransactions) && structured.legacyTransactions.length) {
          legacyTransactions = structured.legacyTransactions.map((tx) => ({ ...(tx || {}) }));
        }
      }

      if (!metricsV1) {
        const transactionsFallback = transactionsV1.length ? transactionsV1 : [];
        const inflowsMinor = transactionsFallback
          .filter((tx) => tx.direction === 'inflow')
          .reduce((acc, tx) => acc + tx.amountMinor, 0);
        const outflowsMinor = transactionsFallback
          .filter((tx) => tx.direction === 'outflow')
          .reduce((acc, tx) => acc + Math.abs(tx.amountMinor), 0);
        const periodMeta = metadata.period ?? {};
        metricsV1 = {
          period: {
            start: ensureIsoDate(periodMeta.start) ?? fallbackDate,
            end: ensureIsoDate(periodMeta.end) ?? fallbackDate,
            month:
              ensureIsoMonth(periodMeta.month ?? periodMeta.Date ?? documentMonth) ??
              fallbackDate.slice(0, 7),
          },
          inflowsMinor,
          outflowsMinor,
          netMinor: inflowsMinor - outflowsMinor,
        };
        if (!validateStatementMetricsV1(metricsV1)) {
          const level = featureFlags.strictMetricsV1 ? 'error' : 'warn';
          logger[level](
            { fileId: insight.fileId, errors: validateStatementMetricsV1.errors },
            'Legacy statement mapping failed validation'
          );
        }
      }
    }

    if (!transactionsV1.length) {
      legacyTransactions.forEach((tx, index) => {
        const normalised = normaliseTransactionRecord(tx ?? {}, fallbackDate, currency, 'legacy', index, metadata);
        if (normalised) transactionsV1.push(normalised);
      });
    }
  }

  return {
    metricsV1,
    transactionsV1,
    legacyMetrics,
    legacyTransactions,
    metadata,
    currency,
    documentDate: fallbackDate,
    documentMonth,
  };
}

function computeBackfillPatch(insight) {
  const preferred = preferV1(insight);
  const patch = {};
  if (insight.version !== 'v1') patch.version = 'v1';
  if (!insight.currency) patch.currency = preferred.currency;
  if (!insight.documentDate) patch.documentDate = new Date(preferred.documentDate);
  if (!insight.documentDateV1) patch.documentDateV1 = preferred.documentDate;
  if (!insight.documentMonth) patch.documentMonth = preferred.documentMonth;
  if (!insight.metricsV1 && preferred.metricsV1) patch.metricsV1 = preferred.metricsV1;
  if (!insight.transactionsV1 && preferred.transactionsV1.length)
    patch.transactionsV1 = preferred.transactionsV1;
  return patch;
}

module.exports = {
  STATEMENT_TYPES,
  normaliseTransactionRecord,
  buildDocumentMonth,
  preferV1,
  computeBackfillPatch,
};
