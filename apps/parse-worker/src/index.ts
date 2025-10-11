import 'dotenv/config';
import { Worker, QueueEvents, Job } from 'bullmq';
import mongoose from 'mongoose';
import crypto from 'node:crypto';
import { Types } from 'mongoose';
import logger from './lib/logger';
import getRedis from './lib/redis';
import connectMongo from './lib/mongo';
import { loadOverrides, applyOverrides } from './lib/overrides';
import { extractText } from './lib/extractor/text';
import routeExtraction from './lib/extractor/router';
import { payslipSchema } from './lib/types';
import { DocumentInsights } from './lib/models';

const queueName = process.env.DOC_INSIGHTS_QUEUE || 'doc-insights';
const prefix = process.env.BULLMQ_PREFIX || 'ai_accountant';
const concurrency = Number.parseInt(process.env.WORKER_CONCURRENCY || '5', 10);

function mmYYYYToDate(value?: string): Date | null {
  if (!value) return null;
  const [month, year] = value.split('/');
  if (!month || !year) return null;
  return new Date(Date.UTC(Number.parseInt(year, 10), Number.parseInt(month, 10) - 1, 1));
}

function computeContentHash(payload: unknown): string {
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify(payload));
  return hash.digest('hex');
}

async function processJob(job: Job) {
  const { userId, fileId, docType, text } = job.data || {};
  if (!userId || !fileId || !docType) {
    throw new Error('Job payload missing userId, fileId or docType');
  }

  await connectMongo();
  const { text: resolvedText } = await extractText({ fileId, text });

  const overrides = await loadOverrides(String(userId), String(docType));
  const overrideApplication = applyOverrides(overrides, resolvedText);
  if (overrideApplication.errors.length) {
    const details = overrideApplication.errors.map((e) => `${e.fieldKey}: ${e.error}`).join('; ');
    const error = new Error(`Override guardrail failure: ${details}`);
    (error as any).code = 'OVERRIDE_GUARDRAIL';
    throw error;
  }

  const extraction = await routeExtraction(docType, resolvedText, overrideApplication.applied);
  if (docType === 'payslip') {
    payslipSchema.parse(extraction.metrics.payslip);
  }

  const metrics = extraction.metrics;
  const metadata = { ...(extraction.metadata || {}) };
  const payPeriod = (metrics as any)?.payslip?.period || {};
  const mmYYYY = payPeriod.payDate || payPeriod.periodEnd || payPeriod.periodStart;
  if (!mmYYYY) {
    metadata.notes = [metadata.notes, 'No pay period detected'].filter(Boolean).join(' | ') || 'No pay period detected';
  }
  const documentMonth = mmYYYY || null;
  const documentDate = mmYYYYToDate(mmYYYY);
  if (documentMonth) {
    metadata.documentMonth = documentMonth;
  }
  metadata.extractionSource = metadata.extractionSource || 'heuristic';
  if (overrideApplication.applied.size) {
    metadata.overridesApplied = Array.from(overrideApplication.applied.keys());
  }
  const userObjectId = new Types.ObjectId(userId);
  const now = new Date();
  const contentHash = computeContentHash({ userId, fileId, docType, metrics, metadata });

  await DocumentInsights.findOneAndUpdate(
    { userId: userObjectId, fileId, insightType: docType },
    {
      $set: {
        catalogueKey: docType,
        baseKey: docType,
        insightType: docType,
        schemaVersion: 'parse-worker@1',
        parserVersion: 'parse-worker@1',
        promptVersion: 'parse-worker@heuristic',
        model: 'heuristic-parser',
        extractionSource: 'heuristic',
        metrics,
        metadata,
        documentMonth,
        documentDate,
        contentHash,
        updatedAt: now,
        extractedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true, setDefaultsOnInsert: true }
  ).exec();

  logger.info({ jobId: job.id, userId, fileId, docType }, 'Document insights updated');
  return { metrics, metadata };
}

const connection = getRedis();

const worker = new Worker(queueName, processJob, { connection, prefix, concurrency });

const events = new QueueEvents(queueName, { connection: getRedis(), prefix });

events.on('completed', ({ jobId }) => {
  logger.info({ jobId }, 'Job completed');
});

events.on('failed', ({ jobId, failedReason }) => {
  logger.error({ jobId, failedReason }, 'Job failed');
});

worker.on('error', (err) => {
  logger.error({ err }, 'Worker error');
});

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down parse worker');
  await worker.close();
  await events.close();
  if (connection.status !== 'end') {
    connection.disconnect();
  }
  if (mongoose.connection.readyState) {
    await mongoose.connection.close();
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
