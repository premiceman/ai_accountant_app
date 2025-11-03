import { setTimeout as sleep } from 'node:timers/promises';
import { Readable } from 'node:stream';
import pino from 'pino';
import type { Types } from 'mongoose';
import {
  VaultDocumentModel,
  VaultJobModel,
  DocumentExtractModel,
  DocumentRecordModel,
  DocumentDlqModel,
  type VaultDocument,
} from '../models/index.js';
import { getObject } from '../lib/r2.js';
import {
  submitDocument,
  waitForWorkflowJob,
  fetchStandardization,
  type WorkflowJob,
} from './docupipeClient.js';
import { detectDocumentType, normalizePayslip, normalizeStatement } from './normalization.js';
import { DOCUPIPE_WORKFLOW_ID } from '../config/docupipe.js';

const logger = pino({ name: 'docupipe-pipeline', level: process.env.LOG_LEVEL ?? 'info' });

const POLL_INTERVAL_MS = parseInterval(process.env.DOCUPIPE_POLL_INTERVAL_MS, 5000);
const POLL_TIMEOUT_MS = parseInterval(process.env.DOCUPIPE_POLL_TIMEOUT_MS, 10 * 60 * 1000);

const PIPELINE_STEPS = [
  'Uploaded',
  'Queued',
  'Classified',
  'Standardized',
  'Post-Processed',
  'Indexed',
  'Ready',
] as const;

type PipelineStepName = (typeof PIPELINE_STEPS)[number];

type MutableJob = {
  _id: Types.ObjectId;
  documentId: Types.ObjectId;
  status: 'queued' | 'running' | 'completed' | 'failed';
  error?: string | null;
  steps: Array<{
    name: PipelineStepName | string;
    status: string;
    startedAt: Date | null;
    endedAt: Date | null;
    message: string | null;
  }>;
};

let running = false;
let loopPromise: Promise<void> | null = null;

function parseInterval(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(1000, parsed) : fallback;
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function ensureWorkflowConfigured(): void {
  if (!DOCUPIPE_WORKFLOW_ID) {
    throw new Error('DOCUPIPE_WORKFLOW_ID not configured');
  }
}

function stepFor(steps: MutableJob['steps'], name: PipelineStepName): MutableJob['steps'][number] {
  let existing = steps.find((step) => step.name === name);
  if (!existing) {
    existing = {
      name,
      status: 'pending',
      startedAt: null,
      endedAt: null,
      message: null,
    };
    steps.push(existing);
  }
  return existing;
}

async function mutateJob(documentId: Types.ObjectId, mutator: (job: MutableJob) => void | Promise<void>): Promise<void> {
  const jobDoc = await VaultJobModel.findOne({ documentId }).lean();
  if (!jobDoc) {
    return;
  }
  const job: MutableJob = {
    _id: jobDoc._id as Types.ObjectId,
    documentId: jobDoc.documentId as Types.ObjectId,
    status: jobDoc.status,
    error: jobDoc.error ?? null,
    steps: Array.isArray(jobDoc.steps)
      ? jobDoc.steps.map((step) => ({
          name: step.name,
          status: step.status,
          startedAt: step.startedAt ? new Date(step.startedAt) : null,
          endedAt: step.endedAt ? new Date(step.endedAt) : null,
          message: step.message ?? null,
        }))
      : [],
  };

  await mutator(job);

  await VaultJobModel.updateOne(
    { _id: job._id },
    {
      $set: {
        status: job.status,
        error: job.error ?? null,
        steps: job.steps,
        updatedAt: new Date(),
      },
    }
  );
}

async function markStep(
  documentId: Types.ObjectId,
  name: PipelineStepName,
  update: Partial<MutableJob['steps'][number]>
): Promise<void> {
  await mutateJob(documentId, (job) => {
    const step = stepFor(job.steps, name);
    if (update.status && update.status !== step.status) {
      if (update.status === 'running' && !step.startedAt) {
        step.startedAt = new Date();
      }
      if ((update.status === 'completed' || update.status === 'failed') && !update.endedAt) {
        step.endedAt = new Date();
      }
    }
    Object.assign(step, update);
  });
}

async function setJobStatus(
  documentId: Types.ObjectId,
  status: MutableJob['status'],
  error?: string | null
): Promise<void> {
  await mutateJob(documentId, (job) => {
    job.status = status;
    if (status === 'failed') {
      job.error = error ?? 'Processing failed';
    } else if (error) {
      job.error = error;
    }
  });
}

async function processPendingSubmission(): Promise<boolean> {
  const now = new Date();
  const doc = await VaultDocumentModel.findOneAndUpdate(
    {
      status: 'uploaded',
      $and: [
        {
          $or: [
            { 'docupipe.documentId': { $exists: false } },
            { 'docupipe.documentId': null },
          ],
        },
        {
          $or: [
            { 'docupipe.status': { $exists: false } },
            { 'docupipe.status': null },
            { 'docupipe.status': 'queued' },
          ],
        },
      ],
    },
    {
      $set: {
        'docupipe.status': 'submitting',
        updatedAt: now,
      },
    },
    { sort: { uploadedAt: 1 }, new: true }
  );

  if (!doc) {
    return false;
  }

  try {
    await submitDocupipe(doc);
    return true;
  } catch (error) {
    logger.error({ err: error, documentId: doc._id.toString() }, 'Docupipe submission failed');
    await handleFailure(doc, 'docupipe_error', 'Unable to submit document');
    return true;
  }
}

async function processInFlight(): Promise<boolean> {
  const doc = await VaultDocumentModel.findOne({
    status: 'processing',
    'docupipe.documentId': { $exists: true, $ne: null },
    'docupipe.status': 'processing',
  })
    .sort({ 'docupipe.lastPolledAt': 1 })
    .lean();

  if (!doc) {
    return false;
  }

  try {
    await pollDocupipe(doc as VaultDocument);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code === 'DOCUPIPE_TIMEOUT' ? 'docupipe_timeout' : 'docupipe_error';
    const message = code === 'docupipe_timeout' ? 'Docupipe timed out' : 'Docupipe polling failed';
    logger.error({ err: error, documentId: doc._id.toString() }, message);
    await handleFailure(doc as VaultDocument, code, message);
    return true;
  }
}

async function submitDocupipe(doc: VaultDocument): Promise<void> {
  ensureWorkflowConfigured();

  const { Body } = await getObject(doc.r2Key);
  if (!(Body instanceof Readable)) {
    throw new Error('Unexpected R2 body type');
  }

  const fileBuffer = await streamToBuffer(Body);
  const submissionStartedAt = new Date();

  await markStep(doc._id, 'Queued', { status: 'completed', endedAt: submissionStartedAt });
  await setJobStatus(doc._id, 'running');
  await markStep(doc._id, 'Classified', { status: 'running', startedAt: submissionStartedAt });

  const submission = await submitDocument({
    workflowId: DOCUPIPE_WORKFLOW_ID,
    filename: doc.filename,
    base64Contents: fileBuffer.toString('base64'),
  });

  await VaultDocumentModel.updateOne(
    { _id: doc._id },
    {
      $set: {
        status: 'processing',
        'docupipe.status': 'processing',
        'docupipe.documentId': submission.documentId,
        'docupipe.workflowId': DOCUPIPE_WORKFLOW_ID,
        'docupipe.jobId': submission.jobId ?? null,
        'docupipe.runId': submission.runId ?? null,
        'docupipe.submittedAt': submissionStartedAt,
        'docupipe.lastPolledAt': submissionStartedAt,
      },
    }
  );
}

async function pollDocupipe(doc: VaultDocument): Promise<void> {
  const jobId = doc.docupipe?.jobId;
  if (!jobId) {
    throw new Error('Docupipe jobId missing for polling');
  }

  const now = new Date();
  await VaultDocumentModel.updateOne(
    { _id: doc._id },
    { $set: { 'docupipe.lastPolledAt': now } }
  );

  const result = await waitForWorkflowJob(jobId, {
    intervalMs: POLL_INTERVAL_MS,
    timeoutMs: POLL_TIMEOUT_MS,
  });

  if (result.status === 'failed') {
    throw new Error(result.error || 'Docupipe job failed');
  }

  await markStep(doc._id, 'Classified', { status: 'completed', endedAt: new Date() });
  await markStep(doc._id, 'Standardized', { status: 'running', startedAt: new Date() });

  const documentId = doc.docupipe?.documentId;
  if (!documentId) {
    throw new Error('Docupipe documentId missing after completion');
  }

  const payload = await fetchStandardization(documentId);
  if (!payload || payload.data === undefined) {
    throw new Error('Docupipe standardization missing data');
  }

  await markStep(doc._id, 'Post-Processed', { status: 'running', startedAt: new Date() });
  await handleStandardization(doc, result, payload);
}

async function handleStandardization(
  doc: VaultDocument,
  _result: WorkflowJob,
  payload: Record<string, unknown>
): Promise<void> {
  const completedAt = new Date();
  const rawData = payload.data ?? payload;
  const documentType = detectDocumentType(payload);

  await DocumentExtractModel.updateOne(
    { userId: doc.userId, documentId: doc._id },
    {
      $set: {
        type: documentType,
        docupipe: {
          documentId: doc.docupipe?.documentId,
          raw: rawData,
        },
      },
    },
    { upsert: true }
  );

  let integrityStatus: 'pass' | 'fail' = 'pass';
  let integrityReason: string | undefined;
  let integrityDelta: number | undefined;

  if (documentType === 'payslip') {
    const { normalized, integrity, pii } = normalizePayslip(rawData);
    integrityStatus = integrity.status;
    integrityReason = integrity.reason;
    integrityDelta = integrity.delta ?? undefined;

    await markStep(doc._id, 'Indexed', { status: 'running', startedAt: new Date() });

    await DocumentRecordModel.updateOne(
      { userId: doc.userId, documentId: doc._id },
      {
        $set: {
          type: 'payslip',
          normalized,
          integrity,
        },
      },
      { upsert: true }
    );

    if (pii?.niLast3) {
      await VaultDocumentModel.updateOne(
        { _id: doc._id },
        { $set: { 'pii.niLast3': pii.niLast3 } }
      );
    }
  } else if (documentType === 'bankStatement') {
    const { normalized, integrity, pii } = normalizeStatement(rawData);
    integrityStatus = integrity.status;
    integrityReason = integrity.reason;
    integrityDelta = integrity.delta ?? undefined;

    await markStep(doc._id, 'Indexed', { status: 'running', startedAt: new Date() });

    await DocumentRecordModel.updateOne(
      { userId: doc.userId, documentId: doc._id },
      {
        $set: {
          type: 'bankStatement',
          normalized,
          integrity,
        },
      },
      { upsert: true }
    );

    if (pii?.accountLast4) {
      await VaultDocumentModel.updateOne(
        { _id: doc._id },
        { $set: { 'pii.accountLast4': pii.accountLast4 } }
      );
    }
  } else {
    integrityStatus = 'fail';
    integrityReason = 'unsupported_type';
    await markStep(doc._id, 'Indexed', { status: 'running', startedAt: new Date() });
    await DocumentRecordModel.updateOne(
      { userId: doc.userId, documentId: doc._id },
      {
        $set: {
          type: 'unknown',
          normalized: payload,
          integrity: { status: 'fail', reason: 'unsupported_type' },
        },
      },
      { upsert: true }
    );
  }

  if (integrityStatus === 'fail') {
    const reason =
      integrityReason === 'net_identity_failed'
        ? 'net_identity_failed'
        : integrityReason === 'balance_mismatch'
        ? 'balance_mismatch'
        : 'docupipe_error';
    await DocumentDlqModel.updateOne(
      { userId: doc.userId, documentId: doc._id },
      {
        $set: {
          reason,
          details: {
            integrity: integrityReason,
            delta: integrityDelta ?? null,
          },
        },
      },
      { upsert: true }
    );

    await markStep(doc._id, 'Standardized', { status: 'completed', endedAt: completedAt });
    await markStep(doc._id, 'Post-Processed', { status: 'failed', endedAt: completedAt, message: integrityReason || null });
    await markStep(doc._id, 'Indexed', { status: 'failed', endedAt: completedAt, message: integrityReason || null });
    await markStep(doc._id, 'Ready', { status: 'failed', endedAt: completedAt, message: integrityReason || null });
    await setJobStatus(doc._id, 'failed', integrityReason || 'Integrity check failed');
    await VaultDocumentModel.updateOne(
      { _id: doc._id },
      {
        $set: {
          status: 'failed',
          'docupipe.status': 'failed',
          'docupipe.completedAt': completedAt,
        },
      }
    );
    return;
  }

  await markStep(doc._id, 'Standardized', { status: 'completed', endedAt: completedAt });
  await markStep(doc._id, 'Post-Processed', { status: 'completed', endedAt: completedAt });
  await markStep(doc._id, 'Indexed', { status: 'completed', endedAt: completedAt });
  await markStep(doc._id, 'Ready', { status: 'completed', endedAt: completedAt });
  await setJobStatus(doc._id, 'completed');

  await VaultDocumentModel.updateOne(
    { _id: doc._id },
    {
      $set: {
        status: 'ready',
        'docupipe.status': 'completed',
        'docupipe.completedAt': completedAt,
      },
    }
  );
}

async function handleFailure(doc: VaultDocument, reason: string, message: string): Promise<void> {
  await DocumentDlqModel.updateOne(
    { userId: doc.userId, documentId: doc._id },
    {
      $setOnInsert: { createdAt: new Date() },
      $set: {
        reason,
        details: { message },
      },
    },
    { upsert: true }
  );

  await markStep(doc._id, 'Ready', { status: 'failed', endedAt: new Date(), message });
  await setJobStatus(doc._id, 'failed', message);

  await VaultDocumentModel.updateOne(
    { _id: doc._id },
    {
      $set: {
        status: 'failed',
        'docupipe.status': 'failed',
        'docupipe.completedAt': new Date(),
      },
    }
  );
}

async function loop(): Promise<void> {
  while (running) {
    let worked = false;
    try {
      worked = (await processPendingSubmission()) || worked;
      worked = (await processInFlight()) || worked;
    } catch (error) {
      logger.error({ err: error }, 'Docupipe loop error');
    }

    if (!worked) {
      await sleep(1000);
    }
  }
}

export async function startDocupipePipeline(): Promise<void> {
  if (running) return;
  running = true;
  ensureWorkflowConfigured();
  loopPromise = loop();
}

export async function stopDocupipePipeline(): Promise<void> {
  running = false;
  await loopPromise;
  loopPromise = null;
}
