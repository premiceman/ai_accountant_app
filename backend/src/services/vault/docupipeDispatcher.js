'use strict';

const path = require('path');
const VaultDocumentJob = require('../../../models/VaultDocumentJob');
const DocumentInsight = require('../../../models/DocumentInsight');
const { getObject, putObject } = require('../../lib/r2');
const { createLogger } = require('../../lib/logger');
const { DOCUPIPE_WORKFLOW_ID } = require('../../config/docupipe');
const {
  postDocument,
  startStandardize,
  getJob,
  getStandardization,
} = require('../docupipe.async');
const { normaliseDateFields } = require('../documents/dateFieldNormaliser');

const logger = createLogger({ name: 'docupipe-dispatcher' });

const POLL_INITIAL_DELAY = 750;
const POLL_MAX_DELAY = 8000;
const POLL_TIMEOUT_MS = 6 * 60 * 1000; // 6 minutes
const MONTH_YEAR_REGEX = /^(0[1-9]|1[0-2])\/\d{4}$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneStandardizationData(data) {
  if (!isPlainObject(data) && !Array.isArray(data)) {
    return data;
  }
  try {
    return JSON.parse(JSON.stringify(data));
  } catch (error) {
    logger.warn(
      { error: error?.message, stack: error?.stack },
      'Failed to clone DocuPipe standardisation payload'
    );
    return data;
  }
}

function extractDataSection(payload) {
  if (isPlainObject(payload?.data)) return payload.data;
  return isPlainObject(payload) ? payload : {};
}

function getValueAtPath(source, path) {
  if (!path || !isPlainObject(source)) return null;
  const segments = path.split('.');
  let current = source;
  for (const segment of segments) {
    if (!isPlainObject(current) || !(segment in current)) {
      return null;
    }
    current = current[segment];
  }
  return current;
}

function containsMonthValue(value) {
  if (!value && value !== 0) return false;
  if (typeof value === 'string') {
    return MONTH_YEAR_REGEX.test(value.trim());
  }
  if (Array.isArray(value)) {
    return value.some((entry) => containsMonthValue(entry));
  }
  if (isPlainObject(value)) {
    return Object.values(value).some((entry) => containsMonthValue(entry));
  }
  return false;
}

function hasPeriodMonthValue(data, preferredPaths = []) {
  for (const path of preferredPaths) {
    const candidate = getValueAtPath(data, path);
    if (containsMonthValue(candidate)) {
      return true;
    }
  }
  return containsMonthValue(data);
}

function resolveDocTypeFromClassification(classificationKey) {
  if (!classificationKey) return null;
  const lower = String(classificationKey).toLowerCase();
  if (lower.includes('payslip')) return 'payslip';
  if (lower.includes('statement')) return 'statement';
  return null;
}

function determineRequiredFields(job, payload) {
  const docType = resolveDocTypeFromClassification(job?.classification?.key);
  if (!docType) return [];
  const dataSection = extractDataSection(payload);
  const missing = [];

  if (docType === 'payslip') {
    const hasMonth = hasPeriodMonthValue(dataSection, ['period', 'metadata.period']);
    if (!hasMonth) {
      missing.push('Period Date (MM/YYYY)');
    }
  } else if (docType === 'statement') {
    const hasMonth = hasPeriodMonthValue(dataSection, [
      'statement.period',
      'period',
      'metadata.period',
      'metrics.period',
    ]);
    if (!hasMonth) {
      missing.push('Period Date (MM/YYYY)');
    }
  }

  return missing;
}

function prepareStandardizationResult(job, rawData) {
  let cloned = cloneStandardizationData(rawData);
  if (isPlainObject(cloned) || Array.isArray(cloned)) {
    normaliseDateFields(cloned);
  } else if (cloned == null) {
    cloned = {};
  } else {
    cloned = { value: cloned };
  }
  const required = determineRequiredFields(job, cloned);
  return { data: cloned, missingRequiredFields: required };
}

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
      logger.error({ jobId, label, error: err.message, docupipe: job?.payload }, 'DocuPipe job failed while waiting');
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
  job.requiresManualFields = null;
  pushAudit(job, 'completed', 'DocuPipe standardisation complete');
  await VaultDocumentJob.updateOne(
    { _id: job._id },
    {
      $set: {
        state: 'completed',
        completedAt: job.completedAt,
        'storage.jsonKey': jsonKey,
        requiresManualFields: null,
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
  logger.error(
    {
      jobId: job?._id,
      fileId: job?.fileId,
      code,
      message,
      stack: error?.stack,
    },
    'DocuPipe job failed'
  );
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

function resolveWorkflowId(job) {
  return job?.docupipe?.workflowId || DOCUPIPE_WORKFLOW_ID;
}

function resolveTypeHint(job) {
  return job?.docupipe?.typeHint || job?.classification?.key || job?.classification?.label || null;
}

async function performDocupipe(job) {
  try {
    if (job?.state && !['queued', 'processing'].includes(job.state)) {
      return;
    }
    if (!job?.storage?.pdfKey && !job?.storage?.trimmedKey) {
      throw new Error('PDF key missing');
    }

    const pdfKey = job.storage.trimmedKey || job.storage.pdfKey;
    const buffer = await readR2Buffer(pdfKey);

    const filename = job.originalName || path.basename(pdfKey) || 'document.pdf';
    const workflowId = resolveWorkflowId(job);
    if (!workflowId) {
      throw new Error('Workflow ID missing for DocuPipe processing');
    }
    const typeHint = resolveTypeHint(job);

    await markJobState(job, 'processing', { note: 'Submitting to DocuPipe' });

    const dispatch = await postDocument({ buffer, filename, typeHint });
    const runId = dispatch?.runId || dispatch?.jobId || dispatch?.documentId;
    const parseJobId = dispatch?.jobId || runId;
    if (!runId) {
      throw new Error('DocuPipe workflow dispatch did not return run id');
    }

    logger.info(
      { jobId: job?._id, fileId: job?.fileId, runId, typeHint },
      'DocuPipe workflow dispatched'
    );

    await VaultDocumentJob.updateOne(
      { _id: job._id },
      {
        $set: {
          state: 'processing',
          'docupipe.documentId': runId,
          'docupipe.parseJobId': parseJobId,
          'docupipe.workflowId': workflowId,
          'docupipe.runId': runId,
          'docupipe.typeHint': typeHint || null,
          updatedAt: new Date(),
        },
        $push: { audit: { state: 'processing', at: new Date(), note: 'DocuPipe parse started' } },
      }
    );

    await waitForJob(parseJobId, { label: 'DocuPipe workflow job' });
    logger.info(
      { jobId: job?._id, fileId: job?.fileId, runId },
      'DocuPipe workflow processing complete'
    );

    const stdRequest = await startStandardize({
      documentId: runId,
      workflowId,
      typeHint,
    });

    const stdJobId = stdRequest?.jobId;
    const standardizationId = Array.isArray(stdRequest?.standardizationIds)
      ? stdRequest.standardizationIds[0]
      : stdRequest?.standardizationIds;
    const effectiveStdJobId = stdJobId || runId;
    const effectiveStandardizationId = standardizationId || runId;

    await VaultDocumentJob.updateOne(
      { _id: job._id },
      {
        $set: {
          'docupipe.stdJobId': effectiveStdJobId,
          'docupipe.standardizationId': effectiveStandardizationId,
          updatedAt: new Date(),
        },
        $push: { audit: { state: 'processing', at: new Date(), note: 'DocuPipe standardisation started' } },
      }
    );

    await waitForJob(effectiveStdJobId, { label: 'DocuPipe standardisation job' });

    const std = await getStandardization(effectiveStandardizationId);
    if (!std || typeof std.data === 'undefined') {
      throw new Error('DocuPipe returned no data');
    }

    const jsonKey = resolveJsonKey(job);
    if (!jsonKey) {
      throw new Error('JSON storage key missing');
    }

    const { data: processedData, missingRequiredFields } = prepareStandardizationResult(job, std.data);

    await writeJsonToR2(jsonKey, processedData);
    logger.info(
      { jobId: job?._id, fileId: job?.fileId, runId, jsonKey },
      'DocuPipe workflow results stored'
    );

    if (Array.isArray(missingRequiredFields) && missingRequiredFields.length > 0) {
      job.storage = job.storage || {};
      job.storage.jsonKey = jsonKey;
      job.requiresManualFields = missingRequiredFields;
      job.state = 'awaiting_manual_json';
      await markJobState(job, 'awaiting_manual_json', {
        'storage.jsonKey': jsonKey,
        requiresManualFields: missingRequiredFields,
        note: `Manual data required: ${missingRequiredFields.join(', ')}`,
      });
      return;
    }

    await completeJob(job, { jsonKey, data: processedData });
    logger.info(
      { jobId: job?._id, fileId: job?.fileId, runId },
      'DocuPipe workflow job completed successfully'
    );
  } catch (error) {
    logger.error(
      {
        jobId: job?._id,
        fileId: job?.fileId,
        error: error?.message,
        code: error?.code,
        stack: error?.stack,
      },
      'DocuPipe workflow job encountered an error'
    );
    await failJob(job, error);
  }
}

function dispatch(job) {
  if (!job || !job._id) return;
  setImmediate(() => {
    performDocupipe(job).catch((err) => {
      logger.error(
        { error: err?.message, stack: err?.stack },
        'DocuPipe dispatcher unhandled failure'
      );
    });
  });
}

module.exports = {
  dispatch,
  performDocupipe,
  readR2Buffer,
  __private__: {
    prepareStandardizationResult,
    determineRequiredFields,
    containsMonthValue,
    resolveDocTypeFromClassification,
  },
};
