// NOTE: Hotfix — TS types for shared flags + FE v1 flip + staged loader + prefer-v1 legacy; aligns with Phase-1/2/3 specs. Additive, non-breaking.
// NOTE: Phase-3 — Frontend uses /api/analytics/v1, staged loader on dashboards, Ajv strict. Rollback via flags.
/**
 * ## Intent (Phase-1 only — additive, no breaking changes)
 *
 * Fix inconsistent dashboards by introducing a tiny, normalised v1 data layer alongside
 * today’s legacy fields. Worker dual-writes new normalised shapes, analytics prefers v1 with
 * legacy fallbacks, and Ajv validators warn without breaking existing flows.
 */

import { setTimeout as sleep } from 'node:timers/promises';
import { Readable } from 'node:stream';
import type { HydratedDocument, Types } from 'mongoose';
import pino from 'pino';
import * as v1 from '../../../shared/v1/index.js';
import { featureFlags } from './config/featureFlags.js';

import { fileIdToKey, getObject } from './lib/r2.js';
import { isPdf } from './lib/pdf.js';
import { sha256 } from './lib/hash.js';
import { canonicaliseInstitution, canonicaliseEmployer } from './lib/canonicalise.js';
import {
  buildRawInstitutionNamesUpdate,
  createNoopSummary,
  ensureSingleOperatorForRawInstitutionNames,
  normalizeRawInstitutionNamesInput,
  summarizeForLogging,
  type RawInstitutionNamesUpdatePlanSummary,
} from './lib/rawInstitutionNames.js';
import {
  AccountModel,
  DocumentInsightModel,
  UploadSessionModel,
  UserDocumentJobModel,
  type Account,
  type DocumentInsight,
  type UploadSession,
  type UserDocumentJob,
} from './models/index.js';
import { rebuildMonthlyAnalytics } from './services/analytics.js';

const logger = pino({ name: 'document-job-loop', level: process.env.LOG_LEVEL ?? 'info' });

const LOG_UPDATE_DOCS = process.env.LOG_UPDATE_DOCS === '1';
const MAX_ATTEMPTS = Math.max(1, parseEnvInt(process.env.DOCUMENT_JOB_MAX_ATTEMPTS, 5));
const BASE_BACKOFF_MS = Math.max(100, parseEnvInt(process.env.DOCUMENT_JOB_BASE_BACKOFF_MS, 1000));
const MAX_BACKOFF_MS = Math.max(BASE_BACKOFF_MS, parseEnvInt(process.env.DOCUMENT_JOB_MAX_BACKOFF_MS, 30000));

export const DOCUMENT_JOB_MAX_ATTEMPTS = MAX_ATTEMPTS;

let running = false;

function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function parseEnvInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return parsed;
}

export function calculateBackoffDelay(attempt: number): number {
  const normalizedAttempt = Math.max(1, attempt);
  const delay = BASE_BACKOFF_MS * 2 ** (normalizedAttempt - 1);
  return Math.min(delay, MAX_BACKOFF_MS);
}

export function determineRetryOutcome(attempts: number): {
  status: 'failed' | 'dead_letter';
  delayMs: number;
} {
  const status = attempts >= MAX_ATTEMPTS ? 'dead_letter' : 'failed';
  const delayMs = status === 'failed' ? calculateBackoffDelay(attempts) : 0;
  return { status, delayMs };
}

function mergeUpdates(
  base: Record<string, any>,
  addition: Record<string, any>
): Record<string, any> {
  const merged: Record<string, any> = { ...base };
  for (const [operator, payload] of Object.entries(addition)) {
    if (!operator.startsWith('$') || typeof payload !== 'object' || payload === null) continue;
    const target = (merged[operator] ??= {});
    Object.assign(target, payload);
  }
  return merged;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function buildIdempotencyKey(
  job: UserDocumentJobDoc,
  summary: RawInstitutionNamesUpdatePlanSummary
): string {
  const digest = sha256(Buffer.from(JSON.stringify(summary)));
  return `${job.jobId}:${job.fileId}:${digest}`;
}

function safeParseSummary(
  summaryString: string | null
): RawInstitutionNamesUpdatePlanSummary | null {
  if (!summaryString) return null;
  try {
    return JSON.parse(summaryString) as RawInstitutionNamesUpdatePlanSummary;
  } catch {
    return null;
  }
}

type UserDocumentJobDoc = HydratedDocument<UserDocumentJob>;
type AccountDoc = HydratedDocument<Account>;
type InsightUpsertPayload = Omit<DocumentInsight, '_id' | 'createdAt' | 'updatedAt'>;
type SupportedClassificationType = Exclude<Classification['type'], 'unknown'>;
type SupportedClassification = Classification & { type: SupportedClassificationType };

type EnsureAccountResult = {
  account: AccountDoc | null;
  planSummary: RawInstitutionNamesUpdatePlanSummary;
  idempotencyKey: string;
  skipped: boolean;
};

type Classification = {
  type:
    | 'payslip'
    | 'current_account_statement'
    | 'savings_account_statement'
    | 'isa_statement'
    | 'investment_statement'
    | 'pension_statement'
    | 'hmrc_correspondence'
    | 'unknown';
  confidence: number;
  employerName: string | null;
  institutionName: string | null;
  accountNumberMasked?: string | null;
};

async function claimJob(): Promise<UserDocumentJobDoc | null> {
  const now = new Date();
  return UserDocumentJobModel.findOneAndUpdate(
    {
      status: { $in: ['pending', 'failed'] },
      processState: { $ne: 'in_progress' },
      attempts: { $lt: MAX_ATTEMPTS },
      $or: [
        { retryAt: { $lte: now } },
        { retryAt: { $exists: false } },
        { retryAt: null },
      ],
    },
    {
      $set: {
        status: 'in_progress',
        processState: 'in_progress',
        lastError: null,
        updatedAt: new Date(),
        retryAt: now,
      },
      $inc: { attempts: 1 },
    },
    { sort: { retryAt: 1, createdAt: 1 }, new: true }
  ).exec();
}

async function setSessionStatus(
  userId: Types.ObjectId,
  fileId: string,
  status: UploadSession['files'][number]['status'],
  reason?: string
) {
  await UploadSessionModel.updateOne(
    { userId, 'files.fileId': fileId },
    {
      $set: {
        'files.$.status': status,
        ...(reason ? { 'files.$.reason': reason } : { 'files.$.reason': null }),
      },
    }
  ).exec();
}

function classifyDocument(originalName: string | null | undefined): Classification {
  const lower = (originalName || '').toLowerCase();
  if (lower.includes('p60') || lower.includes('self assessment') || lower.includes('hmrc')) {
    return { type: 'hmrc_correspondence', confidence: 0.8, employerName: null, institutionName: null };
  }
  if (lower.includes('payslip') || lower.includes('pay slip') || lower.includes('salary')) {
    return {
      type: 'payslip',
      confidence: 0.85,
      employerName: guessEmployer(originalName || ''),
      institutionName: null,
    };
  }
  if (lower.includes('isa')) {
    return {
      type: 'isa_statement',
      confidence: 0.75,
      employerName: null,
      institutionName: guessInstitution(originalName || ''),
    };
  }
  if (lower.includes('pension')) {
    return {
      type: 'pension_statement',
      confidence: 0.75,
      employerName: null,
      institutionName: guessInstitution(originalName || ''),
    };
  }
  if (lower.includes('investment') || lower.includes('brokerage')) {
    return {
      type: 'investment_statement',
      confidence: 0.7,
      employerName: null,
      institutionName: guessInstitution(originalName || ''),
    };
  }
  if (lower.includes('savings')) {
    return {
      type: 'savings_account_statement',
      confidence: 0.7,
      employerName: null,
      institutionName: guessInstitution(originalName || ''),
    };
  }
  if (lower.includes('statement')) {
    return {
      type: 'current_account_statement',
      confidence: 0.65,
      employerName: null,
      institutionName: guessInstitution(originalName || ''),
    };
  }
  return { type: 'unknown', confidence: 0, employerName: null, institutionName: null };
}

function isSupportedClassification(classification: Classification): classification is SupportedClassification {
  return classification.type !== 'unknown';
}

function guessEmployer(name: string): string | null {
  const match = name.split(/[-_]/)[0];
  return canonicaliseEmployer(match.trim());
}

function guessInstitution(name: string): string | null {
  const words = name.split(/[-_\s]/).filter(Boolean);
  const candidate = words.slice(0, 2).join(' ');
  const { canonical } = canonicaliseInstitution(candidate);
  return canonical || candidate || null;
}

function mapAccountType(catalogueKey: Classification['type']): 'Current' | 'Savings' | 'ISA' | 'Investments' | 'Pension' {
  switch (catalogueKey) {
    case 'savings_account_statement':
      return 'Savings';
    case 'isa_statement':
      return 'ISA';
    case 'investment_statement':
      return 'Investments';
    case 'pension_statement':
      return 'Pension';
    default:
      return 'Current';
  }
}

async function ensureAccount(
  job: UserDocumentJobDoc,
  classification: SupportedClassification
): Promise<EnsureAccountResult> {
  if (!classification.institutionName) {
    const planSummary = createNoopSummary(0);
    return {
      account: null,
      planSummary,
      idempotencyKey: buildIdempotencyKey(job, planSummary),
      skipped: true,
    };
  }

  const { canonical, raw } = canonicaliseInstitution(classification.institutionName);
  if (!canonical) {
    const planSummary = createNoopSummary(0);
    return {
      account: null,
      planSummary,
      idempotencyKey: buildIdempotencyKey(job, planSummary),
      skipped: true,
    };
  }

  const accountType = mapAccountType(classification.type);
  const masked = classification.accountNumberMasked || '••••0000';
  const displayName = `${canonical} – ${accountType} (${masked})`;
  const fingerprint = `${canonical}|${masked}|${accountType}`;
  const query = { userId: job.userId, institutionName: canonical, accountNumberMasked: masked, accountType };

  const existingAccount = await AccountModel.findOne(query).exec();
  const currentArray = normalizeRawInstitutionNamesInput(existingAccount?.rawInstitutionNames ?? []);

  let planSummary: RawInstitutionNamesUpdatePlanSummary;
  let plan = null as ReturnType<typeof buildRawInstitutionNamesUpdate> | null;

  if (!existingAccount) {
    plan = buildRawInstitutionNamesUpdate('replace', currentArray, raw ? [raw] : currentArray);
    planSummary = plan.summary;
  } else if (raw) {
    plan = buildRawInstitutionNamesUpdate('appendUnique', currentArray, [raw]);
    planSummary = plan.summary;
  } else {
    planSummary = createNoopSummary(currentArray.length);
  }

  const idempotencyKey = buildIdempotencyKey(job, planSummary);
  const planSummaryString = JSON.stringify(planSummary);

  if (existingAccount && (!plan || !plan.applied) && job.lastCompletedUpdateKey === idempotencyKey) {
    if (LOG_UPDATE_DOCS) {
      logger.info(
        {
          jobId: job.jobId,
          fileId: job.fileId,
          updatePlanSummary: summarizeForLogging(planSummary),
        },
        'rawInstitutionNames update already applied'
      );
    }
    return { account: existingAccount, planSummary, idempotencyKey, skipped: true };
  }

  const baseUpdate: Record<string, any> = {
    $set: { lastSeenAt: new Date() },
    $setOnInsert: {
      displayName,
      fingerprints: [fingerprint],
      firstSeenAt: new Date(),
    },
  };

  const updateDoc = plan ? mergeUpdates(baseUpdate, plan.update) : baseUpdate;

  try {
    ensureSingleOperatorForRawInstitutionNames(updateDoc);
  } catch (error) {
    const conflictError = error as Error & {
      updatePlanSummaryString?: string;
      updatePlanSummaryObject?: RawInstitutionNamesUpdatePlanSummary;
      idempotencyKey?: string;
    };
    conflictError.updatePlanSummaryString = planSummaryString;
    conflictError.updatePlanSummaryObject = planSummary;
    conflictError.idempotencyKey = idempotencyKey;
    logger.warn(
      {
        jobId: job.jobId,
        fileId: job.fileId,
        conflictingUpdateDetected: true,
        updatePlanSummary: summarizeForLogging(planSummary),
      },
      'Conflicting rawInstitutionNames update blocked'
    );
    throw conflictError;
  }

  if (LOG_UPDATE_DOCS) {
    logger.info(
      { jobId: job.jobId, fileId: job.fileId, updatePlanSummary: summarizeForLogging(planSummary) },
      'rawInstitutionNames update plan'
    );
  }

  const options: Parameters<typeof AccountModel.findOneAndUpdate>[2] = {
    upsert: true,
    new: true,
  };
  if (plan?.arrayFilters && plan.arrayFilters.length > 0) {
    options.arrayFilters = plan.arrayFilters;
  }

  try {
    const account = await AccountModel.findOneAndUpdate(query, updateDoc, options).exec();
    return { account, planSummary, idempotencyKey, skipped: false };
  } catch (error) {
    const dbError = error as Error & {
      updatePlanSummaryString?: string;
      updatePlanSummaryObject?: RawInstitutionNamesUpdatePlanSummary;
      idempotencyKey?: string;
    };
    dbError.updatePlanSummaryString = planSummaryString;
    dbError.updatePlanSummaryObject = planSummary;
    dbError.idempotencyKey = idempotencyKey;
    throw dbError;
  }
}

function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatMonth(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function monthEnd(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

type ValidationError = { instancePath?: string; schemaPath?: string; message?: string };

function buildSchemaError(path: string, errors: ValidationError[] | null | undefined): Error {
  const error = new Error('Schema validation failed');
  (error as Error & { statusCode?: number; details?: unknown }).statusCode = 422;
  (error as Error & { code?: string }).code = 'SCHEMA_VALIDATION_FAILED';
  (error as Error & { details?: unknown }).details = {
    code: 'SCHEMA_VALIDATION_FAILED',
    path,
    details: Array.isArray(errors) ? errors : [],
    hint: 'Data shape invalid; try re-uploading the document.',
  };
  return error;
}

function formatAjvErrors(errors: ValidationError[] | null | undefined): string {
  if (!errors || !errors.length) return 'unknown validation error';
  return errors
    .map((err) => {
      const path = err.instancePath || err.schemaPath;
      return `${path}: ${err.message ?? 'invalid'}`;
    })
    .join('; ');
}

export function enrichPayloadWithV1(
  payload: InsightUpsertPayload,
  classification: SupportedClassification
): InsightUpsertPayload {
  const metadata = (payload.metadata ?? {}) as Record<string, unknown>;
  const fallbackIso =
    v1.ensureIsoDate(
      metadata.documentDate ?? payload.documentDate ?? new Date()
    ) ?? new Date().toISOString().slice(0, 10);
  const inferredMonth = v1.ensureIsoMonth(metadata.documentMonth ?? payload.documentMonth ?? fallbackIso);

  payload.version = 'v1';
  payload.currency = v1.normaliseCurrency((metadata.currency as string | undefined) ?? 'GBP');
  payload.documentDateV1 = fallbackIso;
  payload.documentMonth = inferredMonth ?? payload.documentMonth;

  const metrics = (payload.metrics ?? {}) as Record<string, unknown>;

  if (classification.type === 'payslip') {
    const employerName = typeof metadata.employerName === 'string' ? metadata.employerName : null;
    const periodMeta = (metadata.period ?? {}) as Record<string, unknown>;
    const periodMetric = (metrics.period ?? {}) as Record<string, unknown>;
    const periodStart =
      v1.ensureIsoDate(periodMetric.start ?? periodMeta.start) ?? fallbackIso;
    const periodEnd = v1.ensureIsoDate(periodMetric.end ?? periodMeta.end) ?? fallbackIso;
    const periodMonth =
      v1.ensureIsoMonth(periodMetric.month ?? periodMeta.month ?? inferredMonth) ??
      (fallbackIso ? fallbackIso.slice(0, 7) : '1970-01');
    const payDate = v1.ensureIsoDate(metrics.payDate ?? metadata.payDate ?? fallbackIso) ?? fallbackIso;
    const normalizedMetrics = {
      payDate,
      period: { start: periodStart, end: periodEnd, month: periodMonth },
      employer: employerName,
      grossMinor: v1.toMinorUnits(metrics.gross),
      netMinor: v1.toMinorUnits(metrics.net),
      taxMinor: v1.toMinorUnits(metrics.tax),
      nationalInsuranceMinor: v1.toMinorUnits(metrics.ni ?? metrics.nationalInsurance),
      pensionMinor: v1.toMinorUnits(metrics.pension),
      studentLoanMinor: v1.toMinorUnits(metrics.studentLoan),
      taxCode:
        typeof metrics.taxCode === 'string'
          ? metrics.taxCode
          : typeof metadata.taxCode === 'string'
          ? metadata.taxCode
          : null,
    } satisfies v1.PayslipMetricsV1;

    if (!v1.validatePayslipMetricsV1(normalizedMetrics)) {
      const errors = v1.validatePayslipMetricsV1.errors as ValidationError[] | null | undefined;
      if (featureFlags.enableAjvStrict) {
        throw buildSchemaError('shared/schemas/payslipMetricsV1.json', errors);
      }
      logger.warn(
        {
          fileId: payload.fileId,
          type: classification.type,
          errors: formatAjvErrors(errors),
        },
        'Payslip v1 metrics failed validation'
      );
    } else {
      payload.metricsV1 = normalizedMetrics;
    }
  }

  const rawTransactions = Array.isArray(payload.transactions) ? payload.transactions : [];
  const normalizedTransactions: v1.TransactionV1[] = [];

  rawTransactions.forEach((tx, index) => {
    const record = (tx ?? {}) as Record<string, unknown>;
    const rawId = record.id ?? record.transactionId ?? `legacy-${index}`;
    const isoDate =
      v1.ensureIsoDate(record.date ?? record.postedAt ?? fallbackIso) ?? fallbackIso;
    const baseAmountMinor =
      typeof record.amountMinor === 'number'
        ? Math.round(record.amountMinor as number)
        : v1.toMinorUnits(record.amount);
    const rawDirection = String(record.direction ?? '').toLowerCase();
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
      id: String(rawId || `legacy-${index}`),
      date: isoDate,
      description: String(record.description ?? record.name ?? ''),
      amountMinor,
      direction,
      category: v1.normaliseCategory(record.category ?? record.normalisedCategory),
      accountId:
        typeof record.accountId === 'string'
          ? record.accountId
          : typeof metadata.accountId === 'string'
          ? metadata.accountId
          : null,
      accountName:
        typeof record.accountName === 'string'
          ? record.accountName
          : typeof metadata.accountName === 'string'
          ? metadata.accountName
          : null,
      currency: payload.currency ?? 'GBP',
    };

    if (!v1.validateTransactionV1(candidate)) {
      const errors = v1.validateTransactionV1.errors as ValidationError[] | null | undefined;
      if (featureFlags.enableAjvStrict) {
        throw buildSchemaError('shared/schemas/transactionV1.json', errors);
      }
      logger.warn(
        {
          fileId: payload.fileId,
          index,
          errors: formatAjvErrors(errors),
        },
        'Statement transaction failed v1 validation'
      );
      return;
    }
    normalizedTransactions.push(candidate);
  });

  payload.transactionsV1 = normalizedTransactions;

  if (
    classification.type === 'current_account_statement' ||
    classification.type === 'savings_account_statement' ||
    classification.type === 'isa_statement' ||
    classification.type === 'investment_statement' ||
    classification.type === 'pension_statement'
  ) {
    const periodMeta = (metadata.period ?? {}) as Record<string, unknown>;
    const periodStart = v1.ensureIsoDate(periodMeta.start) ?? fallbackIso;
    const periodEnd = v1.ensureIsoDate(periodMeta.end) ?? fallbackIso;
    const periodMonth =
      v1.ensureIsoMonth(periodMeta.month ?? inferredMonth) ??
      (fallbackIso ? fallbackIso.slice(0, 7) : '1970-01');
    const inflowsMinor = normalizedTransactions
      .filter((tx) => tx.direction === 'inflow')
      .reduce((acc, tx) => acc + tx.amountMinor, 0);
    const outflowsMinor = normalizedTransactions
      .filter((tx) => tx.direction === 'outflow')
      .reduce((acc, tx) => acc + Math.abs(tx.amountMinor), 0);
    const metricsV1 = {
      period: { start: periodStart, end: periodEnd, month: periodMonth },
      inflowsMinor,
      outflowsMinor,
      netMinor: inflowsMinor - outflowsMinor,
    } satisfies v1.StatementMetricsV1;

    if (!v1.validateStatementMetricsV1(metricsV1)) {
      const errors = v1.validateStatementMetricsV1.errors as ValidationError[] | null | undefined;
      if (featureFlags.enableAjvStrict) {
        throw buildSchemaError('shared/schemas/statementMetricsV1.json', errors);
      }
      logger.warn(
        {
          fileId: payload.fileId,
          type: classification.type,
          errors: formatAjvErrors(errors),
        },
        'Statement v1 metrics failed validation'
      );
    } else {
      payload.metricsV1 = metricsV1;
    }
  }

  return payload;
}

function buildInsightPayload(
  job: UserDocumentJobDoc,
  classification: SupportedClassification,
  buffer: Buffer
): InsightUpsertPayload {
  const today = new Date();
  const documentDate = today;
  const documentMonth = formatMonth(today);
  const metadata: Record<string, unknown> = {
    period: {
      start: formatDate(monthStart(today)),
      end: formatDate(monthEnd(today)),
    },
    documentDate: formatDate(today),
  };
  if (classification.employerName) {
    metadata.employerName = canonicaliseEmployer(classification.employerName);
  }
  if (classification.institutionName) {
    const { canonical, raw } = canonicaliseInstitution(classification.institutionName);
    metadata.institutionName = canonical;
    metadata.rawInstitutionName = raw;
  }

  const basePayload: InsightUpsertPayload = {
    userId: job.userId,
    fileId: job.fileId,
    catalogueKey: classification.type,
    baseKey: classification.type,
    schemaVersion: job.schemaVersion,
    parserVersion: job.parserVersion,
    promptVersion: job.promptVersion,
    model: job.model,
    extractionSource: 'heuristic',
    confidence: classification.confidence,
    contentHash: sha256(buffer),
    documentDate,
    documentMonth,
    documentLabel: null as unknown as DocumentInsight['documentLabel'],
    documentName: null as unknown as DocumentInsight['documentName'],
    nameMatchesUser: null as unknown as DocumentInsight['nameMatchesUser'],
    collectionId: job.collectionId ?? null,
    metadata: metadata as DocumentInsight['metadata'],
    metrics: {},
    transactions: [],
    version: 'v1',
    currency: 'GBP',
    documentDateV1: formatDate(today),
    metricsV1: null,
    transactionsV1: [],
    narrative: [`classification=${classification.type}`, `confidence=${classification.confidence}`],
    extractedAt: new Date(),
  };

  switch (classification.type) {
    case 'payslip':
      basePayload.metrics = {
        gross: 0,
        net: 0,
        tax: 0,
        ni: 0,
        pension: 0,
        studentLoan: 0,
        payFrequency: 'Monthly',
        annualisedGross: 0,
        totalDeductions: 0,
        takeHomePercent: 0,
        effectiveMarginalRate: 0,
      };
      (basePayload.metadata as Record<string, unknown>).accountHolder = null;
      break;
    case 'current_account_statement':
    case 'savings_account_statement':
    case 'isa_statement':
    case 'investment_statement':
    case 'pension_statement':
      (basePayload.metadata as Record<string, unknown>).accountType = mapAccountType(classification.type);
      (basePayload.metadata as Record<string, unknown>).accountNumberMasked =
        classification.accountNumberMasked || '••••0000';
      basePayload.metrics = {
        openingBalance: 0,
        closingBalance: 0,
        inflows: 0,
        outflows: 0,
        contributions: 0,
        interestOrDividends: 0,
        estReturn: 0,
      };
      break;
    case 'hmrc_correspondence':
      basePayload.metrics = {
        totalPay: 0,
        taxPaid: 0,
        niPaid: 0,
        studentLoan: 0,
        pension: 0,
      };
      break;
    default:
      break;
  }

  return basePayload;
}

async function processJob(job: UserDocumentJobDoc): Promise<void> {
  logger.info({ jobId: job.jobId, fileId: job.fileId }, 'Processing job');
  let lastPlanSummary: RawInstitutionNamesUpdatePlanSummary | null = null;
  let lastPlanSummaryString: string | null = null;
  let lastIdempotencyKey: string | null = null;
  await setSessionStatus(job.userId, job.fileId, 'processing');
  const key = fileIdToKey(job.fileId);
  const object = await getObject(key);
  const body = object.Body as Readable | Uint8Array | Buffer & { transformToByteArray?: () => Promise<Uint8Array> };
  let buffer: Buffer;
  if (body instanceof Readable) {
    buffer = await streamToBuffer(body);
  } else if (Buffer.isBuffer(body)) {
    buffer = Buffer.from(body);
  } else if (body instanceof Uint8Array) {
    buffer = Buffer.from(body);
  } else if (typeof (body as any)?.transformToByteArray === 'function') {
    const arr = await (body as any).transformToByteArray();
    buffer = Buffer.from(arr);
  } else {
    throw new Error('Unable to read object body');
  }
  if (!isPdf(buffer)) {
    throw new Error('File is not a valid PDF');
  }

  const existing = await DocumentInsightModel.findOne({
    userId: job.userId,
    fileId: job.fileId,
    schemaVersion: job.schemaVersion,
  })
    .lean<DocumentInsight | null>()
    .exec();
  if (existing) {
    logger.info({ jobId: job.jobId }, 'Insight already exists; skipping');
    await finalizeJob(job, 'succeeded');
    await setSessionStatus(job.userId, job.fileId, 'done');
    return;
  }

  const classification = classifyDocument(job.originalName || '');
  if (!isSupportedClassification(classification) || classification.confidence < 0.6) {
    await rejectJob(job, 'Unsupported or low confidence document');
    return;
  }

  const payload = buildInsightPayload(job, classification, buffer);
  enrichPayloadWithV1(payload, classification);
  const accountResult = await ensureAccount(job, classification);
  lastPlanSummary = accountResult.planSummary;
  lastPlanSummaryString = JSON.stringify(accountResult.planSummary);
  lastIdempotencyKey = accountResult.idempotencyKey;
  job.lastUpdatePlanSummary = lastPlanSummaryString;
  job.lastCompletedUpdateKey = lastIdempotencyKey;
  if (accountResult.account) {
    (payload.metadata as Record<string, unknown>).accountId = accountResult.account._id;
    (payload.metadata as Record<string, unknown>).institutionName = accountResult.account.institutionName;
  }

  await UserDocumentJobModel.updateOne(
    { _id: job._id },
    { $set: { candidateType: classification.type, lastUpdatePlanSummary: lastPlanSummaryString ?? null } }
  ).exec();

  await DocumentInsightModel.findOneAndUpdate(
    { userId: job.userId, fileId: job.fileId, schemaVersion: job.schemaVersion },
    {
      $set: {
        ...payload,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  ).exec();

  await rebuildMonthlyAnalytics({ userId: job.userId, month: payload.documentMonth });

  await finalizeJob(job, 'succeeded', {
    lastUpdatePlanSummary: lastPlanSummaryString,
    lastCompletedUpdateKey: lastIdempotencyKey,
  });
  await setSessionStatus(job.userId, job.fileId, 'done');
}

async function finalizeJob(
  job: UserDocumentJobDoc,
  outcome: 'succeeded' | 'failed',
  extra: Record<string, unknown> = {}
): Promise<void> {
  const baseSet: Record<string, unknown> = {
    status: outcome,
    processState: outcome === 'succeeded' ? 'succeeded' : 'failed',
    updatedAt: new Date(),
    ...extra,
  };
  if (outcome === 'succeeded') {
    baseSet.lastError = null;
    baseSet.retryAt = new Date();
  }
  await UserDocumentJobModel.updateOne({ _id: job._id }, { $set: baseSet }).exec();
}

async function rejectJob(job: UserDocumentJobDoc, reason: string): Promise<void> {
  await UserDocumentJobModel.updateOne(
    { _id: job._id },
    {
      $set: {
        status: 'rejected',
        processState: 'failed',
        lastError: { code: 'REJECTED', message: reason },
        updatedAt: new Date(),
      },
    }
  ).exec();
  await setSessionStatus(job.userId, job.fileId, 'rejected', reason);
  logger.warn({ jobId: job.jobId, reason }, 'Job rejected');
}

export async function startDocumentJobLoop(): Promise<void> {
  if (running) return;
  running = true;
  logger.info('Starting document job loop');

  while (running) {
    try {
      const job = await claimJob();
      if (!job) {
        await sleep(2000);
        continue;
      }

      try {
        await processJob(job);
      } catch (error) {
        logger.error({ err: error, jobId: job.jobId }, 'Failed to process job');
        const attempts = job.attempts;
        const { status, delayMs } = determineRetryOutcome(attempts);
        const retryAt = status === 'failed' ? new Date(Date.now() + delayMs) : new Date();
        const enrichedError = error as Error & {
          updatePlanSummaryString?: string | null;
          updatePlanSummaryObject?: RawInstitutionNamesUpdatePlanSummary | null;
          idempotencyKey?: string | null;
        };
        const summaryStringFromError =
          enrichedError.updatePlanSummaryString ?? job.lastUpdatePlanSummary ?? null;
        const summaryObjectFromError =
          enrichedError.updatePlanSummaryObject ?? safeParseSummary(summaryStringFromError);
        const idempotencyKey = enrichedError.idempotencyKey ?? job.lastCompletedUpdateKey ?? null;
        const failureMetadata = JSON.stringify({
          message: (error as Error).message,
          updatePlanSummary: summaryObjectFromError,
          idempotencyKey,
        });
        const update: Record<string, unknown> = {
          status,
          processState: 'failed',
          lastError: { code: 'PROCESSING_ERROR', message: failureMetadata },
          updatedAt: new Date(),
          lastUpdatePlanSummary: summaryStringFromError ?? null,
        };
        if (status === 'failed') {
          update.retryAt = retryAt;
        } else {
          update.retryAt = null;
        }
        await UserDocumentJobModel.updateOne(
          { _id: job._id },
          { $set: update }
        ).exec();
        if (status === 'dead_letter') {
          await setSessionStatus(job.userId, job.fileId, 'rejected', 'Exceeded retry attempts');
        }
      }
    } catch (fatal) {
      logger.error({ err: fatal }, 'Fatal error in job loop');
      await sleep(5000);
    }
  }
}

export async function stopDocumentJobLoop(): Promise<void> {
  running = false;
}
