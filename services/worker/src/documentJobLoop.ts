// NOTE: Triage diagnostics for empty transactions (non-destructive). Remove after issue is resolved.
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
import { extractPayslip, extractStatement } from './shared/extraction.js';
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
import { buildPayslipMetricsV1, buildStatementV1 } from '../../../shared/lib/insights/normalizeV1.js';
import { categoriseTransactions } from './services/transactionCategorizer.js';

const logger = pino({ name: 'document-job-loop', level: process.env.LOG_LEVEL ?? 'info' });
const TRIAGE_AREA = 'statement-triage';

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

function isStatementClassification(type: Classification['type']): boolean {
  return type.endsWith('_statement');
}

function coerceMinorUnits(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^-?\d+$/.test(trimmed)) {
      const parsed = Number.parseInt(trimmed, 10);
      return Number.isNaN(parsed) ? null : Math.round(parsed);
    }
  }
  return null;
}

function parseStatementAmountToMinor(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value * 100);
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withoutSpaces = trimmed
    .replace(/[\u202f\u00a0]/gu, '')
    .replace(/\s+/gu, '')
    .replace(/(GBP|USD|EUR)/gi, '')
    .replace(/[£€$]/g, '');
  const negativeByParens = /^\(.*\)$/.test(withoutSpaces);
  const stripped = withoutSpaces.replace(/[()]/g, '');
  const sanitised = stripped.replace(/[,']/g, '');
  const numericPortion = sanitised.replace(/[^0-9.\-]/g, '');
  if (!numericPortion) return null;
  const parsed = Number.parseFloat(numericPortion);
  if (!Number.isFinite(parsed)) return null;
  let amountMinor = Math.round(parsed * 100);
  if (negativeByParens || /^-/.test(stripped)) {
    amountMinor = -Math.abs(amountMinor);
  }
  return amountMinor;
}

function parseStatementDateValue(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
    const match = trimmed.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (match) {
      const day = match[1].padStart(2, '0');
      const month = match[2].padStart(2, '0');
      const year = match[3].length === 2 ? `20${match[3]}` : match[3].padStart(4, '0');
      return `${year}-${month}-${day}`;
    }
  }
  return v1.ensureIsoDate(value);
}

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
    if (featureFlags.enableTriageLogs && isStatementClassification(classification.type)) {
      logger.info(
        {
          area: TRIAGE_AREA,
          phase: 'idempotency',
          jobId: job.jobId,
          fileId: job.fileId,
          contentHash: null,
          parserVersion: job.parserVersion,
          promptVersion: job.promptVersion,
          decision: 'skip',
          reason: 'account-update-unchanged',
        },
        'statement triage'
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

export async function enrichPayloadWithV1(
  payload: InsightUpsertPayload,
  classification: SupportedClassification,
  options?: { jobId?: string }
): Promise<InsightUpsertPayload> {
  const metadata = (payload.metadata ?? {}) as Record<string, unknown>;
  const fallbackIso = v1.ensureIsoDate(metadata.documentDate ?? payload.documentDate ?? payload.documentDateV1 ?? null);
  const inferredMonth = v1.ensureIsoMonth(
    metadata.documentMonth ?? payload.documentMonth ?? fallbackIso ?? undefined
  );

  payload.version = 'v1';
  const currencySource =
    (typeof payload.currency === 'string' ? payload.currency : null) ??
    (metadata.currency as string | undefined) ??
    'GBP';
  payload.currency = v1.normaliseCurrency(currencySource);
  payload.documentDateV1 = fallbackIso ?? payload.documentDateV1 ?? null;
  if (inferredMonth) {
    payload.documentMonth = inferredMonth;
  }

  const triageJobId = options?.jobId ?? null;
  const shouldLogTriage = featureFlags.enableTriageLogs && isStatementClassification(classification.type);

  if (classification.type === 'payslip') {
    const metricsV1 = buildPayslipMetricsV1({
      ...payload,
      insightType: 'payslip',
      metadata: payload.metadata ?? {},
      metrics: payload.metrics ?? {},
    });
    if (!metricsV1) {
      logger.warn(
        { fileId: payload.fileId, type: classification.type },
        'Payslip v1 metrics not generated'
      );
    } else {
      payload.metricsV1 = metricsV1;
      if (!v1.validatePayslipMetricsV1(metricsV1)) {
        const errors = v1.validatePayslipMetricsV1.errors as ValidationError[] | null | undefined;
        const level = featureFlags.strictMetricsV1 ? 'error' : 'warn';
        logger[level](
          {
            fileId: payload.fileId,
            type: classification.type,
            errors: formatAjvErrors(errors),
          },
          'Payslip v1 metrics failed validation'
        );
      }
    }
  }

  const rawTransactions = Array.isArray(payload.transactions) ? payload.transactions : [];
  let normalizedTransactions: v1.TransactionV1[] = [];
  let droppedCount = 0;
  const dropSummary: { invalidAmount: number; invalidDate: number; validationFailed: number } = {
    invalidAmount: 0,
    invalidDate: 0,
    validationFailed: 0,
  };

  if (shouldLogTriage) {
    logger.info(
      { area: TRIAGE_AREA, phase: 'extraction', jobId: triageJobId ?? undefined, fileId: payload.fileId, linesParsed: rawTransactions.length },
      'statement triage'
    );
  }

  rawTransactions.forEach((tx, index) => {
    const record = (tx ?? {}) as Record<string, unknown>;
    const rawId = record.id ?? record.transactionId ?? `legacy-${index}`;
    const amountMinorFromField = coerceMinorUnits((record as Record<string, unknown>).amountMinor);
    const computedAmountMinor =
      amountMinorFromField ??
      parseStatementAmountToMinor(
        record.amount ?? (record as Record<string, unknown>).value ?? (record as Record<string, unknown>).total
      );
    if (computedAmountMinor == null) {
      droppedCount += 1;
      dropSummary.invalidAmount += 1;
      if (shouldLogTriage) {
        logger.info(
          { area: TRIAGE_AREA, phase: 'normalisation-drop', jobId: triageJobId ?? undefined, fileId: payload.fileId, index, reason: 'invalid_amount' },
          'statement triage'
        );
      }
      return;
    }

    const isoDate = parseStatementDateValue(record.date ?? record.postedAt ?? (record as Record<string, unknown>).valueDate);
    if (!isoDate) {
      droppedCount += 1;
      dropSummary.invalidDate += 1;
      if (shouldLogTriage) {
        logger.info(
          { area: TRIAGE_AREA, phase: 'normalisation-drop', jobId: triageJobId ?? undefined, fileId: payload.fileId, index, reason: 'invalid_date' },
          'statement triage'
        );
      }
      return;
    }

    const normalizedAmountMinor = Math.abs(computedAmountMinor);
    const direction: 'inflow' | 'outflow' = computedAmountMinor < 0 ? 'outflow' : 'inflow';
    const finalAmountMinor = direction === 'outflow' ? -Math.abs(normalizedAmountMinor) : Math.abs(normalizedAmountMinor);

    const candidate: v1.TransactionV1 = {
      id: String(rawId || `legacy-${index}`),
      date: isoDate,
      description: String(record.description ?? record.name ?? record.memo ?? ''),
      amountMinor: finalAmountMinor,
      direction,
      category: v1.normaliseCategory(record.category ?? record.normalisedCategory ?? record.type),
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
      currency: v1.normaliseCurrency((record.currency as string | undefined) ?? payload.currency ?? 'GBP'),
    };

    if (!v1.validateTransactionV1(candidate)) {
      droppedCount += 1;
      dropSummary.validationFailed += 1;
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
      if (shouldLogTriage) {
        logger.info(
          { area: TRIAGE_AREA, phase: 'normalisation-drop', jobId: triageJobId ?? undefined, fileId: payload.fileId, index, reason: 'validation_failed' },
          'statement triage'
        );
      }
      return;
    }
    normalizedTransactions.push(candidate);
  });

  if (normalizedTransactions.length && isStatementClassification(classification.type)) {
    try {
      normalizedTransactions = await categoriseTransactions({
        userId: payload.userId as unknown as Types.ObjectId,
        transactions: normalizedTransactions,
        logger,
      });
    } catch (error) {
      logger.warn({ err: error, fileId: payload.fileId }, 'Failed to categorise transactions');
    }
  }

  if (shouldLogTriage) {
    const sample = normalizedTransactions.slice(0, 3);
    logger.info(
      {
        area: TRIAGE_AREA,
        phase: 'normalisation',
        jobId: triageJobId ?? undefined,
        fileId: payload.fileId,
        txNormalised: normalizedTransactions.length,
        dropped: droppedCount,
        dropSummary,
        sampleDates: sample.map((tx) => tx.date),
        sampleAmounts: sample.map((tx) => tx.amountMinor),
      },
      'statement triage'
    );
  }

  payload.transactionsV1 = normalizedTransactions;

  if (
    classification.type === 'current_account_statement' ||
    classification.type === 'savings_account_statement' ||
    classification.type === 'isa_statement' ||
    classification.type === 'investment_statement' ||
    classification.type === 'pension_statement'
  ) {
    const metricsV1 = buildStatementV1({
      ...payload,
      insightType: classification.type,
      metadata: payload.metadata ?? {},
      transactionsV1: normalizedTransactions,
    });
    if (!metricsV1) {
      logger.warn(
        { fileId: payload.fileId, type: classification.type },
        'Statement v1 metrics not generated'
      );
    } else {
      payload.metricsV1 = metricsV1;
      if (!v1.validateStatementMetricsV1(metricsV1)) {
        const errors = v1.validateStatementMetricsV1.errors as ValidationError[] | null | undefined;
        const level = featureFlags.strictMetricsV1 ? 'error' : 'warn';
        logger[level](
          {
            fileId: payload.fileId,
            type: classification.type,
            errors: formatAjvErrors(errors),
          },
          'Statement v1 metrics failed validation'
        );
      }
    }
  }

  return payload;
}

function buildInsightPayload(
  job: UserDocumentJobDoc,
  classification: SupportedClassification,
  buffer: Buffer
): InsightUpsertPayload {
  const metadata: Record<string, unknown> = {
    period: {
      start: null,
      end: null,
      month: null,
    },
    documentDate: null,
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
    documentDate: null as unknown as DocumentInsight['documentDate'],
    documentMonth: null as unknown as DocumentInsight['documentMonth'],
    documentLabel: null as unknown as DocumentInsight['documentLabel'],
    documentName: null as unknown as DocumentInsight['documentName'],
    nameMatchesUser: null as unknown as DocumentInsight['nameMatchesUser'],
    collectionId: job.collectionId ?? null,
    metadata: metadata as DocumentInsight['metadata'],
    metrics: {},
    transactions: [],
    version: 'v1',
    currency: 'GBP',
    documentDateV1: null as unknown as DocumentInsight['documentDateV1'],
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

  const classification = classifyDocument(job.originalName || '');
  const shouldLogTriage = featureFlags.enableTriageLogs && isStatementClassification(classification.type);
  if (shouldLogTriage) {
    logger.info(
      {
        area: TRIAGE_AREA,
        phase: 'classification',
        jobId: job.jobId,
        fileId: job.fileId,
        predictedType: classification.type,
        confidence: Number.parseFloat(classification.confidence.toFixed(2)),
      },
      'statement triage'
    );
  }

  const existing = await DocumentInsightModel.findOne({
    userId: job.userId,
    fileId: job.fileId,
    schemaVersion: job.schemaVersion,
  })
    .lean<DocumentInsight | null>()
    .exec();
  if (existing) {
    if (shouldLogTriage) {
      logger.info(
        {
          area: TRIAGE_AREA,
          phase: 'idempotency',
          jobId: job.jobId,
          fileId: job.fileId,
          contentHash: existing.contentHash ?? null,
          parserVersion: job.parserVersion,
          promptVersion: job.promptVersion,
          decision: 'skip',
          reason: 'insight-exists',
        },
        'statement triage'
      );
    }
    logger.info({ jobId: job.jobId }, 'Insight already exists; skipping');
    await finalizeJob(job, 'succeeded');
    await setSessionStatus(job.userId, job.fileId, 'done');
    return;
  }

  if (!isSupportedClassification(classification) || classification.confidence < 0.6) {
    await rejectJob(job, 'Unsupported or low confidence document');
    return;
  }

  const payload = buildInsightPayload(job, classification, buffer);
  if (classification.type === 'payslip') {
    try {
      const extraction = await extractPayslip(buffer);
      const metrics = (payload.metrics ?? {}) as Record<string, unknown>;
      payload.metrics = {
        ...metrics,
        gross: extraction.gross ?? null,
        net: extraction.net ?? null,
        tax: extraction.tax ?? null,
        ni: extraction.ni ?? null,
        pensionEmployee: extraction.pensionEmployee ?? null,
        pensionEmployer: extraction.pensionEmployer ?? null,
        pension: extraction.pensionEmployee ?? extraction.pensionEmployer ?? null,
        studentLoan: extraction.studentLoan ?? null,
        payFrequency: extraction.payFrequency ?? null,
        payDate: extraction.payDate ?? null,
        taxCode: extraction.taxCode ?? null,
        niLetter: extraction.niLetter ?? null,
        period: extraction.period ?? null,
        ytd: extraction.ytd ?? null,
      };
      const existingMetadata = (payload.metadata ?? {}) as Record<string, unknown>;
      const period = extraction.period ?? {};
      payload.metadata = {
        ...existingMetadata,
        employerName: extraction.employer ?? (existingMetadata.employerName as string | null) ?? null,
        payDate: extraction.payDate ?? (existingMetadata.payDate as string | null) ?? null,
        taxCode: extraction.taxCode ?? (existingMetadata.taxCode as string | null) ?? null,
        niLetter: extraction.niLetter ?? (existingMetadata.niLetter as string | null) ?? null,
        period: {
          start: period.start ?? null,
          end: period.end ?? null,
          month: period.month ?? null,
        },
        provenance: {
          ...(existingMetadata.provenance as Record<string, unknown> | undefined),
          ...(extraction.provenance ?? {}),
        },
      } as typeof payload.metadata;
      if (extraction.ytd) {
        (payload.metadata as Record<string, unknown>).ytd = extraction.ytd;
      }
      const payDate = extraction.payDate ? new Date(extraction.payDate) : null;
      if (payDate && !Number.isNaN(payDate.getTime()) && extraction.payDate) {
        const payDateIso = extraction.payDate as string;
        payload.documentDate = payDate;
        payload.documentMonth = payDateIso.slice(0, 7);
        payload.documentDateV1 = payDateIso;
      } else if (period.month) {
        payload.documentMonth = period.month;
      }
      if (!payload.metadata) payload.metadata = {} as typeof payload.metadata;
      payload.parserVersion = process.env.PARSER_VERSIONS_PAYSLIP || 'payslip@1.3.0';
    } catch (err) {
      logger.warn({ jobId: job.jobId, err }, 'Payslip extraction failed; using defaults');
    }
  } else if (isStatementClassification(classification.type)) {
    try {
      const extraction = await extractStatement(buffer);
      payload.transactions = Array.isArray(extraction.transactions) ? extraction.transactions : [];
      const metrics = (payload.metrics ?? {}) as Record<string, unknown>;
      payload.metrics = {
        ...metrics,
        openingBalance: extraction.openingBalance ?? 0,
        closingBalance: extraction.closingBalance ?? 0,
        inflows: extraction.inflows ?? 0,
        outflows: extraction.outflows ?? 0,
      };
      const existingMetadata = (payload.metadata ?? {}) as Record<string, unknown>;
      const periodStart = extraction.period?.start ?? null;
      const periodEnd = extraction.period?.end ?? null;
      const derivedMonth = periodEnd?.slice(0, 7) ?? periodStart?.slice(0, 7) ?? null;
      payload.metadata = {
        ...existingMetadata,
        bankName: extraction.bankName ?? null,
        accountNumberMasked: extraction.accountNumberMasked ?? null,
        accountType: extraction.accountType ?? (existingMetadata.accountType as string | null) ?? null,
        accountHolder: extraction.accountHolder ?? (existingMetadata.accountHolder as string | null) ?? null,
        period: {
          start: periodStart,
          end: periodEnd,
          month: derivedMonth ?? ((existingMetadata.period as { month?: string } | undefined)?.month ?? null),
        },
        provenance: {
          ...(existingMetadata.provenance as Record<string, unknown> | undefined),
          ...(extraction.provenance ?? {}),
        },
      } as typeof payload.metadata;
      const selectedDate = periodEnd || periodStart || null;
      if (selectedDate) {
        const isoDate = new Date(selectedDate);
        if (!Number.isNaN(isoDate.getTime())) {
          payload.documentDate = isoDate;
          payload.documentMonth = selectedDate.slice(0, 7);
          payload.documentDateV1 = selectedDate;
        }
      } else if (derivedMonth) {
        payload.documentMonth = derivedMonth;
      }
      if (!payload.metadata) payload.metadata = {} as typeof payload.metadata;
      payload.parserVersion = process.env.PARSER_VERSIONS_STATEMENT || 'statement@1.0.0';
    } catch (err) {
      logger.warn({ jobId: job.jobId, err }, 'Statement extraction failed; using defaults');
    }
  }
  await enrichPayloadWithV1(payload, classification, { jobId: job.jobId });
  if (shouldLogTriage) {
    logger.info(
      {
        area: TRIAGE_AREA,
        phase: 'idempotency',
        jobId: job.jobId,
        fileId: job.fileId,
        contentHash: payload.contentHash,
        parserVersion: payload.parserVersion,
        promptVersion: payload.promptVersion,
        decision: 'process',
      },
      'statement triage'
    );
  }
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

  const legacyTransactions = Array.isArray(payload.transactions) ? payload.transactions : [];
  const normalisedTransactions = Array.isArray(payload.transactionsV1) ? payload.transactionsV1 : [];
  payload.transactions = legacyTransactions;
  payload.transactionsV1 = normalisedTransactions;

  const updateDoc = {
    $set: {
      ...payload,
      transactions: legacyTransactions,
      transactionsV1: normalisedTransactions,
      updatedAt: new Date(),
    },
    $setOnInsert: { createdAt: new Date() },
  } as const;

  if (shouldLogTriage) {
    const keysWritten = Object.keys(updateDoc.$set ?? updateDoc);
    logger.info(
      {
        area: TRIAGE_AREA,
        phase: 'persist',
        jobId: job.jobId,
        fileId: job.fileId,
        keysWritten,
        counts: {
          txLegacyCount: legacyTransactions.length,
          txV1Count: normalisedTransactions.length,
        },
      },
      'statement triage'
    );
  }

  await DocumentInsightModel.findOneAndUpdate(
    { userId: job.userId, fileId: job.fileId, schemaVersion: job.schemaVersion },
    updateDoc,
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
