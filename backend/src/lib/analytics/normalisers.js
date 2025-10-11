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
const { featureFlags } = require('../featureFlags.js');

const logger = createLogger({ name: 'analytics-normalisers', level: process.env.LOG_LEVEL ?? 'info' });

const STATEMENT_TYPES = new Set([
  'current_account_statement',
  'savings_account_statement',
  'isa_statement',
  'investment_statement',
  'pension_statement',
]);

function buildSchemaError(path, errors, hint) {
  const payload = {
    code: 'SCHEMA_VALIDATION_FAILED',
    path,
    details: Array.isArray(errors) ? errors : [],
  };
  if (hint) payload.hint = hint;
  const error = new Error('Schema validation failed');
  error.statusCode = 422;
  error.expose = true;
  error.details = payload;
  return error;
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
    if (featureFlags.enableAjvStrict) {
      throw buildSchemaError('shared/schemas/transactionV1.json', validateTransactionV1.errors, 'Data shape invalid; try re-uploading the document.');
    }
    logger.warn(context, 'Transaction normalisation failed v1 validation');
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
  const metadata = insight.metadata ?? {};
  const legacyMetrics = insight.metrics ?? {};
  const legacyTransactions = Array.isArray(insight.transactions) ? insight.transactions : [];
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
    const existing = insight.metricsV1;
    if (existing && validatePayslipMetricsV1(existing)) {
      metricsV1 = { ...existing };
    } else {
      const payDate = ensureIsoDate(legacyMetrics.payDate ?? metadata.payDate ?? fallbackDate) ?? fallbackDate;
      const periodMeta = legacyMetrics.period ?? metadata.period ?? {};
      metricsV1 = {
        payDate,
        period: {
          start: ensureIsoDate(periodMeta.start) ?? payDate,
          end: ensureIsoDate(periodMeta.end) ?? payDate,
          month: ensureIsoMonth(periodMeta.month ?? documentMonth) ?? payDate.slice(0, 7),
        },
        employer: typeof metadata.employerName === 'string' ? metadata.employerName : null,
        grossMinor: toMinorUnits(legacyMetrics.gross),
        netMinor: toMinorUnits(legacyMetrics.net),
        taxMinor: toMinorUnits(legacyMetrics.tax),
        nationalInsuranceMinor: toMinorUnits(legacyMetrics.ni ?? legacyMetrics.nationalInsurance),
        pensionMinor: toMinorUnits(legacyMetrics.pension),
        studentLoanMinor: toMinorUnits(legacyMetrics.studentLoan),
        taxCode: typeof legacyMetrics.taxCode === 'string' ? legacyMetrics.taxCode : null,
      };
      if (!validatePayslipMetricsV1(metricsV1)) {
        const details = validatePayslipMetricsV1.errors;
        if (featureFlags.enableAjvStrict) {
          throw buildSchemaError('shared/schemas/payslipMetricsV1.json', details, 'Data shape invalid; try re-uploading the document.');
        }
        logger.warn({ fileId: insight.fileId, errors: details }, 'Legacy payslip mapping failed validation');
      }
    }
  } else if (STATEMENT_TYPES.has(insight.catalogueKey)) {
    const existingTx = Array.isArray(insight.transactionsV1) ? insight.transactionsV1 : [];
    existingTx.forEach((tx, index) => {
      const normalised = normaliseTransactionRecord(tx ?? {}, fallbackDate, currency, 'v1', index, metadata);
      if (normalised) transactionsV1.push(normalised);
    });
    if (!transactionsV1.length) {
      legacyTransactions.forEach((tx, index) => {
        const normalised = normaliseTransactionRecord(tx ?? {}, fallbackDate, currency, 'legacy', index, metadata);
        if (normalised) transactionsV1.push(normalised);
      });
    }
    const existingMetrics = insight.metricsV1;
    if (existingMetrics && validateStatementMetricsV1(existingMetrics)) {
      metricsV1 = { ...existingMetrics };
    } else {
      const inflowsMinor = transactionsV1
        .filter((tx) => tx.direction === 'inflow')
        .reduce((acc, tx) => acc + tx.amountMinor, 0);
      const outflowsMinor = transactionsV1
        .filter((tx) => tx.direction === 'outflow')
        .reduce((acc, tx) => acc + Math.abs(tx.amountMinor), 0);
      const periodMeta = metadata.period ?? {};
      metricsV1 = {
        period: {
          start: ensureIsoDate(periodMeta.start) ?? fallbackDate,
          end: ensureIsoDate(periodMeta.end) ?? fallbackDate,
          month: ensureIsoMonth(periodMeta.month ?? documentMonth) ?? fallbackDate.slice(0, 7),
        },
        inflowsMinor,
        outflowsMinor,
        netMinor: inflowsMinor - outflowsMinor,
      };
      if (!validateStatementMetricsV1(metricsV1)) {
        const details = validateStatementMetricsV1.errors;
        if (featureFlags.enableAjvStrict) {
          throw buildSchemaError('shared/schemas/statementMetricsV1.json', details, 'Data shape invalid; try re-uploading the document.');
        }
        logger.warn({ fileId: insight.fileId, errors: details }, 'Legacy statement mapping failed validation');
      }
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
  buildSchemaError,
  normaliseTransactionRecord,
  buildDocumentMonth,
  preferV1,
  computeBackfillPatch,
};
