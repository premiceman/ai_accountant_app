import { setTimeout as sleep } from 'node:timers/promises';
import { Readable } from 'node:stream';
import type { HydratedDocument, Types } from 'mongoose';
import pino from 'pino';

import { fileIdToKey, getObject } from './lib/r2.js';
import { isPdf } from './lib/pdf.js';
import { sha256 } from './lib/hash.js';
import { canonicaliseInstitution, canonicaliseEmployer } from './lib/canonicalise.js';
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

let running = false;

function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

type UserDocumentJobDoc = HydratedDocument<UserDocumentJob>;
type AccountDoc = HydratedDocument<Account>;
type InsightUpsertPayload = Omit<DocumentInsight, '_id' | 'createdAt' | 'updatedAt'>;
type SupportedClassificationType = Exclude<Classification['type'], 'unknown'>;
type SupportedClassification = Classification & { type: SupportedClassificationType };

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
  return UserDocumentJobModel.findOneAndUpdate(
    {
      status: { $in: ['pending', 'failed'] },
      processState: { $ne: 'in_progress' },
      attempts: { $lt: 5 },
    },
    {
      $set: {
        status: 'in_progress',
        processState: 'in_progress',
        lastError: null,
        updatedAt: new Date(),
      },
      $inc: { attempts: 1 },
    },
    { sort: { createdAt: 1 }, new: true }
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
  userId: Types.ObjectId,
  classification: SupportedClassification
): Promise<AccountDoc | null> {
  if (!classification.institutionName) return null;
  const { canonical, raw } = canonicaliseInstitution(classification.institutionName);
  if (!canonical) return null;
  const accountType = mapAccountType(classification.type);
  const masked = classification.accountNumberMasked || '••••0000';
  const displayName = `${canonical} – ${accountType} (${masked})`;
  const fingerprint = `${canonical}|${masked}|${accountType}`;
  return AccountModel.findOneAndUpdate(
    { userId, institutionName: canonical, accountNumberMasked: masked, accountType },
    {
      $setOnInsert: {
        rawInstitutionNames: raw ? [raw] : [],
        displayName,
        fingerprints: [fingerprint],
        firstSeenAt: new Date(),
      },
      $set: { lastSeenAt: new Date() },
      ...(raw ? { $addToSet: { rawInstitutionNames: raw } } : {}),
    },
    { upsert: true, new: true }
  ).exec();
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

function buildInsightPayload(
  job: UserDocumentJobDoc,
  classification: SupportedClassification,
  buffer: Buffer
): InsightUpsertPayload {
  const today = new Date();
  const documentDate = formatDate(today);
  const documentMonth = formatMonth(today);
  const metadata: Record<string, unknown> = {
    period: {
      start: formatDate(monthStart(today)),
      end: formatDate(monthEnd(today)),
    },
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
    collectionId: job.collectionId ?? null,
    metadata: metadata as DocumentInsight['metadata'],
    metrics: {},
    transactions: [],
    narrative: [`classification=${classification.type}`, `confidence=${classification.confidence}`],
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
  const account = await ensureAccount(job.userId, classification);
  if (account) {
    (payload.metadata as Record<string, unknown>).accountId = account._id;
    (payload.metadata as Record<string, unknown>).institutionName = account.institutionName;
  }

  await UserDocumentJobModel.updateOne({ _id: job._id }, { $set: { candidateType: classification.type } }).exec();

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

  await finalizeJob(job, 'succeeded');
  await setSessionStatus(job.userId, job.fileId, 'done');
}

async function finalizeJob(job: UserDocumentJobDoc, outcome: 'succeeded' | 'failed'): Promise<void> {
  await UserDocumentJobModel.updateOne(
    { _id: job._id },
    {
      $set: {
        status: outcome,
        processState: outcome === 'succeeded' ? 'succeeded' : 'failed',
        updatedAt: new Date(),
      },
    }
  ).exec();
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
        const status = attempts >= 5 ? 'dead_letter' : 'failed';
        await UserDocumentJobModel.updateOne(
          { _id: job._id },
          {
            $set: {
              status,
              processState: 'failed',
              lastError: { code: 'PROCESSING_ERROR', message: (error as Error).message },
            },
          }
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
