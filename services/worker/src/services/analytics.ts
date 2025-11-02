// NOTE: Hotfix — TS types for shared flags + FE v1 flip + staged loader + prefer-v1 legacy; aligns with Phase-1/2/3 specs. Additive, non-breaking.
// NOTE: Phase-3 — Frontend uses /api/analytics/v1, staged loader on dashboards, Ajv strict. Rollback via flags.
/**
 * ## Intent (Phase-1 only — additive, no breaking changes)
 *
 * Fix inconsistent dashboards by introducing a tiny, normalised v1 data layer alongside
 * today’s legacy fields. Worker dual-writes new normalised shapes, analytics prefers v1 with
 * legacy fallbacks, and Ajv validators warn without breaking existing flows.
 */

import type { Types } from 'mongoose';
import pino from 'pino';
import * as v1 from '../../../../shared/v1/index.js';
import { featureFlags } from '../config/featureFlags.js';
import { normalizeInsightV1 } from '../../../../shared/lib/insights/normalizeV1.js';
import {
  DocumentInsightModel,
  UserAnalyticsModel,
  UserOverrideModel,
  type DocumentInsight,
  type UserOverride,
} from '../models/index.js';

const logger = pino({ name: 'analytics-service', level: process.env.LOG_LEVEL ?? 'info' });

const STATEMENT_TYPES = new Set<DocumentInsight['catalogueKey']>([
  'current_account_statement',
  'savings_account_statement',
  'isa_statement',
  'investment_statement',
  'pension_statement',
]);

type ValidationError = { instancePath?: string; schemaPath?: string; message?: string };

function formatAjvErrors(errors: ValidationError[] | null | undefined): string {
  if (!errors || !errors.length) return 'unknown validation error';
  return errors
    .map((err) => {
      const path = err.instancePath || err.schemaPath;
      return `${path}: ${err.message ?? 'invalid'}`;
    })
    .join('; ');
}

function normaliseTransactionRecord(
  source: Record<string, unknown>,
  fallbackDate: string,
  currency: string,
  prefix: string,
  index: number,
  metadata: Record<string, unknown>,
  base?: v1.TransactionV1
): v1.TransactionV1 | null {
  const rawId = source.id ?? source.transactionId ?? base?.id ?? `${prefix}-${index}`;
  const isoDate =
    v1.ensureIsoDate(source.date ?? source.postedAt ?? base?.date ?? fallbackDate) ?? fallbackDate;
  const baseAmountMinor =
    typeof source.amountMinor === 'number'
      ? Math.round(source.amountMinor as number)
      : v1.toMinorUnits(source.amount ?? base?.amountMinor ?? 0);
  const rawDirection = String(source.direction ?? base?.direction ?? '').toLowerCase();
  let direction: 'inflow' | 'outflow' = baseAmountMinor < 0 ? 'outflow' : 'inflow';
  if (rawDirection === 'inflow' || rawDirection === 'outflow') {
    direction = rawDirection;
  }
  let amountMinor = baseAmountMinor;
  if (direction === 'outflow' && amountMinor > 0) {
    amountMinor = -Math.abs(amountMinor);
  } else if (direction === 'inflow' && amountMinor < 0) {
    amountMinor = Math.abs(amountMinor);
  }
  const candidate: v1.TransactionV1 = {
    id: String(rawId || `${prefix}-${index}`),
    date: isoDate,
    description: String(source.description ?? source.name ?? base?.description ?? ''),
    amountMinor,
    direction,
    category: v1.normaliseCategory(source.category ?? source.normalisedCategory ?? base?.category),
    accountId:
      typeof source.accountId === 'string'
        ? source.accountId
        : typeof metadata.accountId === 'string'
        ? (metadata.accountId as string)
        : base?.accountId ?? null,
    accountName:
      typeof source.accountName === 'string'
        ? source.accountName
        : typeof metadata.accountName === 'string'
        ? (metadata.accountName as string)
        : base?.accountName ?? null,
    currency,
  };
  if (!v1.validateTransactionV1(candidate)) {
    const errors = v1.validateTransactionV1.errors as ValidationError[] | null | undefined;
    const level = featureFlags.strictMetricsV1 ? 'error' : 'warn';
    logger[level](
      {
        id: candidate.id,
        errors: formatAjvErrors(errors),
      },
      'Transaction normalisation failed v1 validation'
    );
    return base ?? null;
  }
  return candidate;
}

function groupByCategory(transactions: v1.TransactionV1[]): {
  totalOutflow: number;
  buckets: { category: string; outflow: number; share: number }[];
} {
  const totals = new Map<string, number>();
  for (const tx of transactions) {
    if (tx.direction !== 'outflow') continue;
    if (tx.category === 'Transfers' || tx.category === 'Savings/Transfers') continue;
    const amountMinor = Math.abs(tx.amountMinor);
    if (!amountMinor) continue;
    totals.set(tx.category, (totals.get(tx.category) || 0) + amountMinor);
  }
  const totalOutflowMinor = Array.from(totals.values()).reduce((acc, val) => acc + val, 0);
  const totalOutflow = v1.toMajorUnits(totalOutflowMinor);
  return {
    totalOutflow,
    buckets: Array.from(totals.entries()).map(([category, minor]) => {
      const outflow = v1.toMajorUnits(minor);
      return {
        category,
        outflow,
        share: totalOutflow ? outflow / totalOutflow : 0,
      };
    }),
  };
}

function applyTransactionOverrides(
  transactions: v1.TransactionV1[],
  overrides: UserOverride[],
  metadata: Record<string, unknown>,
  currency: string
): v1.TransactionV1[] {
  const patches = overrides.filter((ovr) => ovr.scope === 'transaction');
  if (!patches.length) return transactions;
  return transactions.map((tx, index) => {
    const relevant = patches.filter((patch) => patch.targetId === tx.id);
    if (!relevant.length) return tx;
    const merged = relevant.reduce<Record<string, unknown>>(
      (acc, patch) => Object.assign(acc, patch.patch as Record<string, unknown>),
      { ...tx }
    );
    const normalised = normaliseTransactionRecord(merged, tx.date, currency, 'override', index, metadata, tx);
    return normalised ?? tx;
  });
}

function applyMetricOverrides<T>(doc: T, overrides: UserOverride[]): T {
  const patches = overrides.filter((ovr) => ovr.scope === 'metric');
  if (!patches.length) return doc;
  const clone = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
  for (const patch of patches) {
    if (!patch.targetId) continue;
    const segments = String(patch.targetId).split('.');
    let cursor: Record<string, unknown> = clone;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const seg = segments[i];
      const value = cursor[seg];
      if (value == null || typeof value !== 'object') {
        cursor[seg] = {};
      }
      cursor = cursor[seg] as Record<string, unknown>;
    }
    cursor[segments[segments.length - 1]] = patch.patch as unknown;
  }
  return clone as T;
}

function assertValidMonth(month: string): void {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error(`Invalid period month ${month}`);
  }
  const parsed = new Date(`${month}-01T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid period month ${month}`);
  }
}

type PreferredInsight = {
  metricsV1: v1.PayslipMetricsV1 | v1.StatementMetricsV1 | null;
  transactionsV1: v1.TransactionV1[];
  legacyMetrics: Record<string, unknown>;
  legacyTransactions: unknown[];
  metadata: Record<string, unknown>;
  currency: string;
  documentDate: string;
  documentMonth: string | null;
};

function preferV1(insight: DocumentInsight): PreferredInsight {
  const metadata = (insight.metadata ?? {}) as Record<string, unknown>;
  const legacyMetrics = (insight.metrics ?? {}) as Record<string, unknown>;
  const legacyTransactions = Array.isArray(insight.transactions) ? insight.transactions : [];
  const currency = v1.normaliseCurrency(insight.currency ?? metadata.currency ?? 'GBP');
  const fallbackDate =
    insight.documentDateV1 ??
    v1.ensureIsoDate(insight.documentDate ?? metadata.documentDate) ??
    new Date().toISOString().slice(0, 10);
  const documentMonth = insight.documentMonth ?? v1.ensureIsoMonth(metadata.documentMonth ?? fallbackDate);

  let metricsV1: v1.PayslipMetricsV1 | v1.StatementMetricsV1 | null = null;
  const transactionsV1: v1.TransactionV1[] = [];

  if (insight.catalogueKey === 'payslip') {
    const normalised = normalizeInsightV1({ ...insight, insightType: 'payslip' });
    if (normalised?.metricsV1) {
      metricsV1 = { ...(normalised.metricsV1 as v1.PayslipMetricsV1) };
      if (!v1.validatePayslipMetricsV1(metricsV1)) {
        const errors = v1.validatePayslipMetricsV1.errors as ValidationError[] | null | undefined;
        const level = featureFlags.strictMetricsV1 ? 'error' : 'warn';
        logger[level](
          {
            fileId: insight.fileId,
            errors: formatAjvErrors(errors),
          },
          'Payslip metricsV1 validation failed; continuing with best-effort values'
        );
      }
    }
    if (!metricsV1) {
      const periodMeta = (legacyMetrics.period ?? metadata.period ?? {}) as Record<string, unknown>;
      const payDate =
        v1.ensureIsoDate(legacyMetrics.payDate ?? metadata.payDate ?? fallbackDate) ?? fallbackDate;
      const employerRecord = (metadata.employer ?? {}) as Record<string, unknown>;
      const employerName =
        typeof employerRecord.name === 'string'
          ? employerRecord.name
          : typeof metadata.employerName === 'string'
          ? metadata.employerName
          : typeof legacyMetrics.employerName === 'string'
          ? (legacyMetrics.employerName as string)
          : null;
      metricsV1 = {
        payDate,
        period: {
          start: v1.ensureIsoDate(periodMeta.start) ?? payDate,
          end: v1.ensureIsoDate(periodMeta.end) ?? payDate,
          month:
            v1.ensureIsoMonth(periodMeta.month ?? periodMeta.Date ?? documentMonth) ??
            payDate.slice(0, 7),
        },
        employer: employerName ? { name: employerName } : null,
        grossMinor: v1.toMinorUnits(legacyMetrics.gross),
        netMinor: v1.toMinorUnits(legacyMetrics.net),
        taxMinor: v1.toMinorUnits(legacyMetrics.tax),
        nationalInsuranceMinor: v1.toMinorUnits(legacyMetrics.ni ?? legacyMetrics.nationalInsurance),
        pensionMinor: v1.toMinorUnits(legacyMetrics.pension),
        studentLoanMinor: v1.toMinorUnits(legacyMetrics.studentLoan),
        taxCode: typeof legacyMetrics.taxCode === 'string' ? legacyMetrics.taxCode : null,
      } satisfies v1.PayslipMetricsV1;
      if (!v1.validatePayslipMetricsV1(metricsV1)) {
        const errors = v1.validatePayslipMetricsV1.errors as ValidationError[] | null | undefined;
        const level = featureFlags.strictMetricsV1 ? 'error' : 'warn';
        logger[level](
          {
            fileId: insight.fileId,
            errors: formatAjvErrors(errors),
          },
          'Legacy payslip mapping failed validation; continuing with best-effort values'
        );
      }
    }
  } else if (STATEMENT_TYPES.has(insight.catalogueKey)) {
    const candidateList = Array.isArray(insight.transactionsV1) ? insight.transactionsV1 : [];
    if (candidateList.length) {
      candidateList.forEach((tx, index) => {
        const normalised = normaliseTransactionRecord(
          (tx ?? {}) as Record<string, unknown>,
          fallbackDate,
          currency,
          'v1',
          index,
          metadata
        );
        if (normalised) {
          transactionsV1.push(normalised);
        }
      });
    }
    if (!transactionsV1.length) {
      legacyTransactions.forEach((tx, index) => {
        const normalised = normaliseTransactionRecord(
          (tx ?? {}) as Record<string, unknown>,
          fallbackDate,
          currency,
          'legacy',
          index,
          metadata
        );
        if (normalised) {
          transactionsV1.push(normalised);
        }
      });
    }
    const normalised = normalizeInsightV1({
      ...insight,
      insightType: insight.catalogueKey,
      transactionsV1,
    });
    if (normalised?.metricsV1) {
      metricsV1 = { ...(normalised.metricsV1 as v1.StatementMetricsV1) };
      if (!v1.validateStatementMetricsV1(metricsV1)) {
        const errors = v1.validateStatementMetricsV1.errors as ValidationError[] | null | undefined;
        const level = featureFlags.strictMetricsV1 ? 'error' : 'warn';
        logger[level](
          {
            fileId: insight.fileId,
            errors: formatAjvErrors(errors),
          },
          'Statement metricsV1 validation failed; continuing with best-effort values'
        );
      }
    }
    if (!metricsV1) {
      const inflowsMinor = transactionsV1
        .filter((tx) => tx.direction === 'inflow')
        .reduce((acc, tx) => acc + tx.amountMinor, 0);
      const outflowsMinor = transactionsV1
        .filter((tx) => tx.direction === 'outflow')
        .reduce((acc, tx) => acc + Math.abs(tx.amountMinor), 0);
      const periodMeta = (metadata.period ?? {}) as Record<string, unknown>;
      metricsV1 = {
        period: {
          start: v1.ensureIsoDate(periodMeta.start) ?? fallbackDate,
          end: v1.ensureIsoDate(periodMeta.end) ?? fallbackDate,
          month:
            v1.ensureIsoMonth(periodMeta.month ?? periodMeta.Date ?? documentMonth) ??
            fallbackDate.slice(0, 7),
        },
        inflowsMinor,
        outflowsMinor,
        netMinor: inflowsMinor - outflowsMinor,
      } satisfies v1.StatementMetricsV1;
      if (!v1.validateStatementMetricsV1(metricsV1)) {
        const errors = v1.validateStatementMetricsV1.errors as ValidationError[] | null | undefined;
        const level = featureFlags.strictMetricsV1 ? 'error' : 'warn';
        logger[level](
          {
            fileId: insight.fileId,
            errors: formatAjvErrors(errors),
          },
          'Legacy statement mapping failed validation; continuing with best-effort values'
        );
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

export async function rebuildMonthlyAnalytics({
  userId,
  month,
}: {
  userId: Types.ObjectId;
  month: string;
}): Promise<void> {
  assertValidMonth(month);

  const insights = await DocumentInsightModel.find({ userId, documentMonth: month }).lean<DocumentInsight[]>().exec();
  const overrides = await UserOverrideModel.find({ userId, appliesFrom: { $lte: `${month}-31` } })
    .lean<UserOverride[]>()
    .exec();

  let incomeGross = 0;
  let incomeNet = 0;
  let incomeOther = 0;
  let spendTotal = 0;
  let cashIn = 0;
  let cashOut = 0;
  let hmrcWithheld = 0;
  let hmrcPaid = 0;

  const statementTransactions: v1.TransactionV1[] = [];

  const sources = {
    payslips: 0,
    statements: 0,
    savings: 0,
    isa: 0,
    investments: 0,
    hmrc: 0,
    pension: 0,
  };

  const savings = { balance: 0, interest: 0 };
  const investments = { balance: 0, contributions: 0, estReturn: 0 };
  const pension = { balance: 0, contributions: 0 };

  for (const insight of insights) {
    const preferred = preferV1(insight);
    const metrics = preferred.legacyMetrics;
    switch (insight.catalogueKey) {
      case 'payslip': {
        sources.payslips += 1;
        const payslip = preferred.metricsV1 as v1.PayslipMetricsV1;
        incomeGross += v1.toMajorUnits(payslip.grossMinor);
        incomeNet += v1.toMajorUnits(payslip.netMinor);
        hmrcWithheld += v1.toMajorUnits(
          payslip.taxMinor + payslip.nationalInsuranceMinor + payslip.studentLoanMinor
        );
        break;
      }
      case 'current_account_statement':
      case 'savings_account_statement':
      case 'isa_statement':
      case 'investment_statement':
      case 'pension_statement': {
        if (insight.catalogueKey === 'current_account_statement') sources.statements += 1;
        if (insight.catalogueKey === 'savings_account_statement') sources.savings += 1;
        if (insight.catalogueKey === 'isa_statement') sources.isa += 1;
        if (insight.catalogueKey === 'investment_statement') sources.investments += 1;
        if (insight.catalogueKey === 'pension_statement') sources.pension += 1;
        const txs = applyTransactionOverrides(
          preferred.transactionsV1,
          overrides,
          preferred.metadata,
          preferred.currency
        );
        statementTransactions.push(...txs);
        if (insight.catalogueKey === 'savings_account_statement') {
          savings.balance = Number(metrics.closingBalance || savings.balance);
          savings.interest += Number(metrics.interestOrDividends || 0);
        }
        if (insight.catalogueKey === 'isa_statement' || insight.catalogueKey === 'investment_statement') {
          investments.balance = Number(metrics.closingBalance || investments.balance);
          investments.contributions += Number(metrics.contributions || 0);
          if (metrics.estReturn != null) {
            investments.estReturn += Number(metrics.estReturn);
          }
        }
        if (insight.catalogueKey === 'pension_statement') {
          pension.balance = Number(metrics.closingBalance || pension.balance);
          pension.contributions += Number(metrics.contributions || 0);
        }
        break;
      }
      case 'hmrc_correspondence': {
        sources.hmrc += 1;
        const hmrcMetrics = (insight.metrics ?? {}) as Record<string, unknown>;
        hmrcPaid += Number(hmrcMetrics.taxPaid || 0);
        break;
      }
      default:
        break;
    }
  }

  if (statementTransactions.length) {
    for (const tx of statementTransactions) {
      if (!tx) continue;
      if (tx.direction === 'inflow') {
        const amount = v1.toMajorUnits(tx.amountMinor);
        cashIn += amount;
        if (tx.category === 'Income') {
          incomeOther += amount;
        }
        if (/(hmrc|tax)/i.test(tx.description)) {
          hmrcPaid += Math.abs(amount);
        }
      } else if (tx.direction === 'outflow') {
        const amount = v1.toMajorUnits(Math.abs(tx.amountMinor));
        cashOut += amount;
        if (tx.category !== 'Transfers' && tx.category !== 'Savings/Transfers') {
          spendTotal += amount;
        }
        if (/(hmrc|tax)/i.test(tx.description)) {
          hmrcPaid += amount;
        }
      }
    }
  }

  const { totalOutflow, buckets } = groupByCategory(statementTransactions);
  if (!spendTotal) {
    spendTotal = totalOutflow;
  }

  const analyticsDoc = applyMetricOverrides(
    {
      userId,
      period: month,
      builtAt: new Date(),
      sources,
      income: {
        gross: incomeGross,
        net: incomeNet,
        other: incomeOther,
      },
      spend: {
        total: spendTotal,
        byCategory: buckets,
        largestExpenses: [],
      },
      cashflow: {
        inflows: cashIn,
        outflows: cashOut,
        net: cashIn - cashOut,
      },
      savings,
      investments,
      pension,
      tax: {
        withheld: hmrcWithheld,
        paidToHMRC: hmrcPaid,
        effectiveRate: incomeGross ? (hmrcWithheld + hmrcPaid) / incomeGross : 0,
      },
      derived: {
        savingsRate: incomeNet ? (incomeNet - spendTotal) / incomeNet : 0,
        topMerchants: [],
      },
    },
    overrides
  );

  await UserAnalyticsModel.findOneAndUpdate(
    { userId, period: month },
    { $set: analyticsDoc },
    { upsert: true, new: true }
  ).exec();
}
