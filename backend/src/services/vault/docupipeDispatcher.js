'use strict';

const path = require('path');
const VaultDocumentJob = require('../../../models/VaultDocumentJob');
const DocumentInsight = require('../../../models/DocumentInsight');
const { getObject, putObject } = require('../../lib/r2');
const {
  postDocument,
  startStandardize,
  getJob,
  getStandardization,
} = require('../docupipe.async');

const POLL_INITIAL_DELAY = 750;
const POLL_MAX_DELAY = 8000;
const POLL_TIMEOUT_MS = 6 * 60 * 1000; // 6 minutes

async function streamToBuffer(body) {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body);
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body.arrayBuffer === 'function') {
    const arr = await body.arrayBuffer();
    return Buffer.from(arr);
  }
  if (typeof body.pipe === 'function') {
    return new Promise((resolve, reject) => {
      const chunks = [];
      body.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      body.on('end', () => resolve(Buffer.concat(chunks)));
      body.on('error', reject);
    });
  }
  throw new Error('UNSUPPORTED_R2_BODY');
}

async function readR2Buffer(key) {
  const object = await getObject(key);
  return streamToBuffer(object?.Body);
}

async function waitForJob(jobId, { label }) {
  if (!jobId) {
    throw new Error(`Missing DocuPipe job id for ${label || 'job'}`);
  }
  let delay = POLL_INITIAL_DELAY;
  let elapsed = 0;
  while (elapsed <= POLL_TIMEOUT_MS) {
    const job = await getJob(jobId);
    if (job?.status === 'failed') {
      const err = new Error(job?.error || `${label || 'Job'} failed`);
      err.code = 'DOCUPIPE_JOB_FAILED';
      err.job = job;
      throw err;
    }
    if (job?.status === 'completed') {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    elapsed += delay;
    delay = Math.min(Math.round(delay * 1.75), POLL_MAX_DELAY);
  }
  const err = new Error(`${label || 'Job'} timed out`);
  err.code = 'DOCUPIPE_JOB_TIMEOUT';
  throw err;
}

function pushAudit(job, state, note) {
  const nextAudit = Array.isArray(job.audit) ? job.audit.slice() : [];
  nextAudit.push({ state, note: note || null, at: new Date() });
  job.audit = nextAudit;
  return nextAudit;
}

async function writeJsonToR2(key, data) {
  const payload = Buffer.from(JSON.stringify(data, null, 2), 'utf8');
  await putObject({ key, body: payload, contentType: 'application/json' });
}

function resolveJsonKey(job) {
  const storage = job?.storage || {};
  const baseKey = storage.trimmedKey || storage.pdfKey;
  if (!baseKey) return null;
  return `${baseKey}.std.json`;
}

function resolveDocumentLabel(classification) {
  if (!classification) return null;
  if (classification.label) return classification.label;
  if (classification.key) {
    return classification.key
      .split('_')
      .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
      .join(' ');
  }
  return null;
}

async function upsertInsight(job, data) {
  const catalogueKey = job.classification?.key || 'payslip';
  const userId = job.userId;
  const fileId = job.fileId;
  const insight = await DocumentInsight.findOneAndUpdate(
    { userId, fileId, insightType: catalogueKey },
    {
      $set: {
        catalogueKey,
        baseKey: catalogueKey,
        schemaVersion: process.env.DOCUPIPE_SCHEMA_VERSION || 'docupipe@1',
        parserVersion: 'docupipe',
        promptVersion: 'docupipe',
        model: 'docupipe',
        contentHash: job.storage?.contentHash || null,
        documentName: job.originalName || null,
        documentLabel: resolveDocumentLabel(job.classification) || null,
        collectionId: job.collectionId || null,
        metadata: data?.metadata || data || {},
        metrics: data?.metrics || {},
        transactions: data?.transactions || [],
        extractedAt: new Date(),
      },
      $setOnInsert: {
        userId,
        fileId,
      },
    },
    { upsert: true, new: true }
  );
  return insight;
}

async function markJobState(job, state, extra = {}) {
  const patch = { state, updatedAt: new Date() };
  Object.assign(patch, extra);
  pushAudit(job, state, extra.note);
  await VaultDocumentJob.updateOne({ _id: job._id }, {
    $set: patch,
    $push: { audit: { state, at: new Date(), note: extra.note || null } },
  });
}

async function completeJob(job, { jsonKey, data }) {
  job.state = 'completed';
  job.storage = job.storage || {};
  job.storage.jsonKey = jsonKey;
  job.completedAt = new Date();
  pushAudit(job, 'completed', 'DocuPipe standardisation complete');
  await VaultDocumentJob.updateOne(
    { _id: job._id },
    {
      $set: {
        state: 'completed',
        completedAt: job.completedAt,
        'storage.jsonKey': jsonKey,
        updatedAt: new Date(),
      },
      $push: { audit: { state: 'completed', at: job.completedAt, note: 'DocuPipe standardisation complete' } },
    }
  );
  await upsertInsight(job, data);
}

async function failJob(job, error) {
  const message = error?.message || 'Processing failed';
  const code = error?.code || 'PROCESSING_FAILED';
  const entry = { message, code, at: new Date() };
  const nextErrors = Array.isArray(job.errors) ? job.errors.slice() : [];
  nextErrors.push(entry);
  await VaultDocumentJob.updateOne(
    { _id: job._id },
    {
      $set: { state: 'failed', updatedAt: new Date() },
      $push: {
        errors: entry,
        audit: { state: 'failed', at: new Date(), note: message },
      },
    }
  );
}

async function performDocupipe(job) {
  try {
    if (!job?.storage?.pdfKey && !job?.storage?.trimmedKey) {
      throw new Error('PDF key missing');
    }

    const pdfKey = job.storage.trimmedKey || job.storage.pdfKey;
    const buffer = await readR2Buffer(pdfKey);

    const filename = job.originalName || path.basename(pdfKey) || 'document.pdf';
    const schemaId = job.docupipe?.schemaId || job.classification?.schemaId;
    if (!schemaId) {
      throw new Error('Schema ID missing for DocuPipe processing');
    }

    await markJobState(job, 'processing', { note: 'Submitting to DocuPipe' });

    const { documentId, jobId: parseJobId } = await postDocument({ buffer, filename });

    await VaultDocumentJob.updateOne(
      { _id: job._id },
      {
        $set: {
          state: 'processing',
          'docupipe.documentId': documentId,
          'docupipe.parseJobId': parseJobId,
          'docupipe.schemaId': schemaId,
          updatedAt: new Date(),
        },
        $push: { audit: { state: 'processing', at: new Date(), note: 'DocuPipe parse started' } },
      }
    );

    await waitForJob(parseJobId, { label: 'DocuPipe parse job' });

    const stdRequest = await startStandardize({
      documentId,
      schemaId,
      stdVersion: job.docupipe?.stdVersion || process.env.DOCUPIPE_STD_VERSION,
    });

    const stdJobId = stdRequest?.jobId;
    const standardizationId = Array.isArray(stdRequest?.standardizationIds)
      ? stdRequest.standardizationIds[0]
      : stdRequest?.standardizationIds;

    await VaultDocumentJob.updateOne(
      { _id: job._id },
      {
        $set: {
          'docupipe.stdJobId': stdJobId,
          'docupipe.standardizationId': standardizationId,
          updatedAt: new Date(),
        },
        $push: { audit: { state: 'processing', at: new Date(), note: 'DocuPipe standardisation started' } },
      }
    );

    await waitForJob(stdJobId, { label: 'DocuPipe standardisation job' });

    const std = await getStandardization(standardizationId);
    if (!std || typeof std.data === 'undefined') {
      throw new Error('DocuPipe returned no data');
    }

    const jsonKey = resolveJsonKey(job);
    if (!jsonKey) {
      throw new Error('JSON storage key missing');
    }

    await writeJsonToR2(jsonKey, std.data);

    await completeJob(job, { jsonKey, data: std.data });
  } catch (error) {
    console.error('[vault:docupipeDispatcher] job failed', job?.fileId, error);
    await failJob(job, error);
  }
}

function dispatch(job) {
  if (!job || !job._id) return;
  setImmediate(() => {
    performDocupipe(job).catch((err) => {
      console.error('[vault:docupipeDispatcher] unhandled failure', err);
    });
  });
}

module.exports = {
  dispatch,
  performDocupipe,
  readR2Buffer,
};
