const { randomUUID } = require('crypto');
const dayjs = require('dayjs');
const { createLogger } = require('../../utils/logger');
const { sha256 } = require('../../utils/hashing');
const { badRequest } = require('../../utils/errors');
const { queue } = require('../ingestQueue');
const { runWorkflow } = require('../docupipe');
const { objectKeyForUpload, readObjectBuffer, writeBuffer } = require('../r2');
const { validatePayslip, validateStatement } = require('../../validation/schemas');
const DocumentInsight = require('../../models/DocumentInsight');
const TransactionV2 = require('../../models/TransactionV2');
const PayslipMetricsV2 = require('../../models/PayslipMetricsV2');
const AccountV2 = require('../../models/AccountV2');
const DeadLetterJob = require('../../models/DeadLetterJob');
const UploadBatch = require('../../models/UploadBatch');
const IngestJob = require('../../models/IngestJob');
const { mapPayslip } = require('./payslipMapper');
const { mapStatement } = require('./statementMapper');
const { enumerateZipBuffers } = require('../../../lib/zip');
const { recomputeSnapshotsForPeriods } = require('../analytics');

const logger = createLogger('ingest');

const metrics = {
  processed: 0,
  skipped: 0,
  failed: 0,
  deadLettered: 0,
};

function increment(metric) {
  if (!Object.prototype.hasOwnProperty.call(metrics, metric)) return;
  metrics[metric] += 1;
  logger.debug('metric.update', { metric, value: metrics[metric] });
}

function logStage(jobDoc, stage, result, extra = {}) {
  logger.info('stage', {
    jobId: jobDoc.jobId,
    userId: jobDoc.userId,
    fileId: jobDoc.fileId,
    stage,
    result,
    ...extra,
  });
}

function deriveLineage(canonical) {
  const lineage = [];
  function add(path, provenance) {
    if (provenance && provenance.fileId) {
      lineage.push({ path, provenance });
    }
  }
  if (!canonical || typeof canonical !== 'object') return lineage;
  if (canonical.provenance) add('', canonical.provenance);
  if (canonical.docType === 'payslip') {
    add('grossPay', canonical.provenance);
    add('netPay', canonical.provenance);
    for (const key of Object.keys(canonical.deductions || {})) {
      add(`deductions.${key}`, canonical.provenance);
    }
    (canonical.earnings || []).forEach((entry, index) => add(`earnings[${index}]`, entry.provenance));
  }
  if (canonical.docType === 'statement') {
    add('account', canonical.account?.provenance);
    (canonical.transactions || []).forEach((tx, index) => add(`transactions[${index}]`, tx.provenance));
  }
  return lineage;
}

function ensurePayslipInvariants(canonical) {
  const deductions = canonical.deductions;
  const totalDeductions = deductions.incomeTax + deductions.nationalInsurance + deductions.pension + deductions.studentLoan + deductions.otherDeductions;
  if (canonical.grossPay - totalDeductions !== canonical.netPay) {
    throw badRequest('Payslip invariant violated: netPay must equal grossPay minus deductions', {
      grossPay: canonical.grossPay,
      deductions,
      netPay: canonical.netPay,
    });
  }
}

function ensureStatementInvariants(canonical) {
  const opening = canonical.period?.openingBalance?.amount;
  const closing = canonical.period?.closingBalance?.amount;
  if (opening === undefined || closing === undefined) return;
  let inflows = 0;
  let outflows = 0;
  for (const tx of canonical.transactions) {
    if (tx.amount >= 0) inflows += tx.amount; else outflows += Math.abs(tx.amount);
  }
  if (opening + inflows - outflows !== closing) {
    throw badRequest('Statement invariant violated: opening + inflows - outflows must equal closing', {
      opening,
      inflows,
      outflows,
      closing,
    });
  }
}

async function persistPayslip(userId, canonical) {
  await PayslipMetricsV2.findOneAndUpdate(
    { userId, fileId: canonical.fileId },
    {
      userId,
      fileId: canonical.fileId,
      contentHash: canonical.contentHash,
      payPeriod: canonical.payPeriod,
      grossPay: canonical.grossPay,
      netPay: canonical.netPay,
      deductions: canonical.deductions,
      provenance: canonical.provenance,
      updatedAt: new Date(),
    },
    { upsert: true, new: true },
  );
  const months = [canonical.payPeriod.paymentDate.slice(0, 7)];
  const taxYear = resolveTaxYear(canonical.payPeriod.paymentDate);
  await recomputeSnapshotsForPeriods(userId, { months, taxYears: [taxYear] });
}

async function persistStatement(userId, canonical) {
  await AccountV2.findOneAndUpdate(
    { userId, accountId: canonical.account.accountId },
    {
      userId,
      accountId: canonical.account.accountId,
      fileId: canonical.fileId,
      contentHash: canonical.contentHash,
      name: canonical.account.name,
      currency: canonical.account.currency,
      sortCode: canonical.account.sortCode,
      accountNumber: canonical.account.accountNumber,
      provenance: canonical.account.provenance,
      updatedAt: new Date(),
    },
    { upsert: true },
  );

  await TransactionV2.deleteMany({ userId, fileId: canonical.fileId });
  if (canonical.transactions.length) {
    await TransactionV2.insertMany(
      canonical.transactions.map((tx) => ({ ...tx, userId, createdAt: new Date() })),
    );
  }

  const months = Array.from(new Set(canonical.transactions.map((tx) => tx.date.slice(0, 7))));
  const taxYears = Array.from(new Set(canonical.transactions.map((tx) => resolveTaxYear(tx.date))));
  await recomputeSnapshotsForPeriods(userId, { months, taxYears });
}

function resolveTaxYear(isoDate) {
  const date = dayjs(isoDate);
  const year = date.year();
  const cutoff = dayjs(`${year}-04-06`);
  if (date.isBefore(cutoff)) {
    const startYear = year - 1;
    return `${startYear}-${String(year).slice(-2)}`;
  }
  const endYear = year + 1;
  return `${year}-${String(endYear).slice(-2)}`;
}

async function writeDocumentInsight({ userId, batchId, canonical, contentHash, sourceKey, docupipeRaw }) {
  const lineage = deriveLineage(canonical);
  await DocumentInsight.findOneAndUpdate(
    { userId, fileId: canonical.fileId },
    {
      userId,
      fileId: canonical.fileId,
      batchId,
      docType: canonical.docType,
      contentHash,
      sourceKey,
      canonical,
      docupipeRaw: docupipeRaw ?? null,
      lineage,
      updatedAt: new Date(),
    },
    { upsert: true },
  );
}

function detectDocType(docupipePayload) {
  const source = docupipePayload?.data ?? docupipePayload;
  const doc = source?.documents?.[0] || source?.document || source;
  const type = (doc.documentType || doc.type || doc.category || '').toLowerCase();
  if (type.includes('payslip')) return 'payslip';
  if (type.includes('statement')) return 'statement';
  if (doc.transactions) return 'statement';
  if (doc.payPeriod || doc.deductions) return 'payslip';
  throw badRequest('Unable to determine document type from Docupipe payload');
}

function isZipBuffer(buffer) {
  if (!buffer || buffer.length < 4) return false;
  return buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
}

async function processCanonical(userId, batchId, canonical, sourceKey, docupipeRaw) {
  if (canonical.docType === 'payslip') {
    validatePayslip(canonical);
    ensurePayslipInvariants(canonical);
    await writeDocumentInsight({
      userId,
      batchId,
      canonical,
      contentHash: canonical.contentHash,
      sourceKey,
      docupipeRaw,
    });
    await persistPayslip(userId, canonical);
    return;
  }
  if (canonical.docType === 'statement') {
    validateStatement(canonical);
    ensureStatementInvariants(canonical);
    await writeDocumentInsight({
      userId,
      batchId,
      canonical,
      contentHash: canonical.contentHash,
      sourceKey,
      docupipeRaw,
    });
    await persistStatement(userId, canonical);
    return;
  }
  throw badRequest(`Unsupported canonical docType ${canonical.docType}`);
}

async function runDocupipeAndMap({ userId, batchId, fileId, fileKey, typeHint, buffer }) {
  const contentHash = sha256(buffer);
  const existing = await DocumentInsight.findOne({ userId, fileId });
  if (existing && existing.contentHash === contentHash) {
    return { status: 'skipped', contentHash };
  }
  const filename = fileKey.split('/').pop() || `${fileId}.pdf`;
  const result = await runWorkflow({ buffer, filename, typeHint });
  const docupipePayload = result?.data ?? result;
  const docType = detectDocType(docupipePayload);
  const documentPayload = docupipePayload?.documents?.[0] || docupipePayload?.document || docupipePayload;
  let canonical;
  if (docType === 'payslip') {
    canonical = mapPayslip(documentPayload, { fileId, contentHash });
  } else if (docType === 'statement') {
    canonical = mapStatement(documentPayload, { fileId, contentHash });
    // augment transactions with provenance defaults
    canonical.transactions = canonical.transactions.map((tx) => ({
      ...tx,
      provenance: tx.provenance || { fileId, page: 1, anchor: tx.transactionId },
    }));
  }
  if (!canonical) throw badRequest('Docupipe returned unsupported document');
  await processCanonical(userId, batchId, canonical, fileKey, result);
  return { status: 'processed', contentHash, canonicalType: canonical.docType };
}

async function updateBatchFileStatus(batchId, fileId, updateFn) {
  const batch = await UploadBatch.findOne({ batchId });
  if (!batch) return;
  const file = batch.files.find((f) => f.fileId === fileId);
  if (!file) return;
  updateFn(file);
  file.updatedAt = new Date();
  await batch.save();
}

async function recomputeBatchSummary(batchId) {
  const batch = await UploadBatch.findOne({ batchId });
  if (!batch) return;
  let processed = 0;
  let failed = 0;
  let skipped = 0;
  batch.files.forEach((file) => {
    const statuses = [file.status, ...(file.children || []).map((child) => child.status)];
    statuses.forEach((status) => {
      if (status === 'processed' || status === 'completed') processed += 1;
      else if (status === 'failed') failed += 1;
      else if (status === 'skipped') skipped += 1;
    });
  });
  batch.summary = { processed, failed, skipped };
  const flatStatuses = batch.files.flatMap((file) => [file.status, ...(file.children || []).map((child) => child.status)]);
  if (flatStatuses.some((status) => status === 'queued' || status === 'pending' || status === 'processing')) {
    batch.status = 'processing';
  } else if (flatStatuses.some((status) => status === 'failed')) {
    batch.status = 'attention';
  } else {
    batch.status = 'processed';
  }
  await batch.save();
}

async function markJob(jobDoc, status, message = null) {
  jobDoc.status = status;
  jobDoc.updatedAt = new Date();
  jobDoc.lastError = message ? { message } : null;
  await jobDoc.save();
}

async function handlePdfJob(jobDoc, buffer) {
  const { userId, batchId, fileId, r2Key, typeHint } = jobDoc;
  logStage(jobDoc, 'docupipe', 'dispatching');
  const result = await runDocupipeAndMap({ userId, batchId, fileId, fileKey: r2Key, typeHint, buffer });
  await updateBatchFileStatus(batchId, fileId, (file) => {
    file.status = result.status;
    file.message = result.status === 'processed' ? result.canonicalType : 'Already processed';
    file.contentHash = result.contentHash;
  });
  logStage(jobDoc, 'docupipe', result.status, { canonicalType: result.canonicalType });
  if (result.status === 'processed') {
    increment('processed');
  } else if (result.status === 'skipped') {
    increment('skipped');
  }
  return result;
}

async function processZipJob(jobDoc, buffer) {
  logStage(jobDoc, 'zip', 'unpacking');
  const files = await enumerateZipBuffers(buffer, ({ fileName }) => fileName.toLowerCase().endsWith('.pdf'));
  if (!files.length) {
    throw badRequest('ZIP archive does not contain any PDF documents');
  }
  const childResults = [];
  for (const entry of files) {
    const childFileId = `${jobDoc.fileId}:${sha256(Buffer.from(entry.fileName)).slice(0, 10)}`;
    const childKey = objectKeyForUpload({
      userId: jobDoc.userId,
      batchId: jobDoc.batchId,
      fileId: childFileId,
      filename: entry.fileName,
    });
    await writeBuffer(childKey, entry.buffer, 'application/pdf');
    const childJob = await IngestJob.create({
      userId: jobDoc.userId,
      jobId: randomUUID(),
      batchId: jobDoc.batchId,
      fileId: childFileId,
      r2Key: childKey,
      typeHint: jobDoc.typeHint,
      status: 'queued',
      attempts: 0,
    });
    await updateBatchFileStatus(jobDoc.batchId, jobDoc.fileId, (file) => {
      file.children.push({ fileId: childFileId, filename: entry.fileName, status: 'queued', r2Key: childKey });
    });
    childResults.push(queue.push(async () => {
      const bufferCopy = entry.buffer; // already Buffer
      logStage({ ...jobDoc, jobId: `${jobDoc.jobId}:${childFileId}`, fileId: childFileId }, 'docupipe', 'dispatching', { child: true });
      const result = await runDocupipeAndMap({
        userId: jobDoc.userId,
        batchId: jobDoc.batchId,
        fileId: childFileId,
        fileKey: childKey,
        typeHint: jobDoc.typeHint,
        buffer: bufferCopy,
      });
      await updateBatchFileStatus(jobDoc.batchId, jobDoc.fileId, (file) => {
        const child = file.children.find((c) => c.fileId === childFileId);
        if (child) {
          child.status = result.status;
          child.message = result.status === 'processed' ? result.canonicalType : 'Already processed';
          child.updatedAt = new Date();
        }
      });
      logStage({ ...jobDoc, jobId: `${jobDoc.jobId}:${childFileId}`, fileId: childFileId }, 'docupipe', result.status, { child: true, canonicalType: result.canonicalType });
      if (result.status === 'processed') {
        increment('processed');
      } else if (result.status === 'skipped') {
        increment('skipped');
      }
      await IngestJob.deleteOne({ _id: childJob._id });
      return result;
    }).catch(async (error) => {
      logger.error('Child job failed', { error: error.message, childFileId });
      await DeadLetterJob.create({
        userId: jobDoc.userId,
        fileId: childFileId,
        jobId: childJob.jobId,
        stage: 'docupipe',
        reason: error.message,
        diagnostics: { stack: error.stack },
      }).catch(() => {});
      increment('failed');
      increment('deadLettered');
      await IngestJob.deleteOne({ _id: childJob._id }).catch(() => {});
      await updateBatchFileStatus(jobDoc.batchId, jobDoc.fileId, (file) => {
        const child = file.children.find((c) => c.fileId === childFileId);
        if (child) {
          child.status = 'failed';
          child.message = error.message;
          child.updatedAt = new Date();
        }
      });
      logStage({ ...jobDoc, jobId: `${jobDoc.jobId}:${childFileId}`, fileId: childFileId }, 'docupipe', 'failed', { child: true, error: error.message });
      return { status: 'failed', error };
    }));
  }
  return Promise.allSettled(childResults);
}

async function processJob(jobDoc) {
  logStage(jobDoc, 'job', 'start');
  await markJob(jobDoc, 'processing');
  jobDoc.attempts += 1;
  const buffer = await readObjectBuffer(jobDoc.r2Key);
  if (isZipBuffer(buffer)) {
    await processZipJob(jobDoc, buffer);
    await updateBatchFileStatus(jobDoc.batchId, jobDoc.fileId, (file) => {
      file.status = 'processed';
      file.message = 'Archive processed';
    });
    await markJob(jobDoc, 'completed');
    await recomputeBatchSummary(jobDoc.batchId);
    logStage(jobDoc, 'job', 'completed', { archive: true });
    return;
  }
  const result = await handlePdfJob(jobDoc, buffer);
  await markJob(jobDoc, result.status === 'processed' ? 'completed' : 'skipped');
  await recomputeBatchSummary(jobDoc.batchId);
  logStage(jobDoc, 'job', result.status);
}

async function runJob(jobDoc) {
  const timer = logger.time('processJob');
  try {
    await processJob(jobDoc);
    timer.end({ jobId: jobDoc.jobId, userId: jobDoc.userId, fileId: jobDoc.fileId, stage: 'job.completed', result: jobDoc.status });
  } catch (error) {
    timer.end({ jobId: jobDoc.jobId, userId: jobDoc.userId, fileId: jobDoc.fileId, stage: 'job.failed', result: 'failed' });
    logger.error('Ingest job failed', { jobId: jobDoc.jobId, error: error.message });
    await markJob(jobDoc, 'failed', error.message);
    await DeadLetterJob.create({
      userId: jobDoc.userId,
      fileId: jobDoc.fileId,
      jobId: jobDoc.jobId,
      stage: 'ingest',
      reason: error.message,
      diagnostics: { stack: error.stack },
    });
    increment('failed');
    increment('deadLettered');
    logStage(jobDoc, 'job', 'dead-lettered', { error: error.message });
    throw error;
  }
}

async function enqueueJob(jobDoc) {
  return queue.push(() => runJob(jobDoc));
}

module.exports = { enqueueJob, runJob, metrics };
