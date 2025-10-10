const { randomUUID } = require('crypto');
const mongoose = require('mongoose');
const UserDocumentJob = require('../../../models/UserDocumentJob');
const UploadSession = require('../../../models/UploadSession');
const DocumentInsight = require('../../../models/DocumentInsight');

const SCHEMA_VERSION = process.env.SCHEMA_VERSION || '2.0';
const DEFAULT_PARSER_VERSIONS = {
  payslip: process.env.PARSER_VERSIONS_PAYSLIP || 'payslip@1.3.0',
  statement: process.env.PARSER_VERSIONS_STATEMENT || 'statement@1.0.0',
};

function resolveParserVersion() {
  return process.env.PARSER_VERSIONS_UNKNOWN || 'unknown@0';
}

function resolveModel() {
  return process.env.OPENAI_MODEL || 'gpt-4o-mini';
}

function resolvePromptVersion() {
  return process.env.PROMPT_VERSION || 'vault-v1';
}

function resolveParserVersionForCatalogue(catalogueKey) {
  if (!catalogueKey) return null;
  if (catalogueKey === 'payslip') {
    return process.env.PARSER_VERSIONS_PAYSLIP || DEFAULT_PARSER_VERSIONS.payslip;
  }
  if (typeof catalogueKey === 'string' && catalogueKey.endsWith('_statement')) {
    return process.env.PARSER_VERSIONS_STATEMENT || DEFAULT_PARSER_VERSIONS.statement;
  }
  return null;
}

async function upsertSession({ userId, sessionId, files }) {
  if (!sessionId) return null;
  const now = new Date();
  const doc = await UploadSession.findOneAndUpdate(
    { userId, sessionId },
    {
      $setOnInsert: { createdAt: now },
      $set: {
        updatedAt: now,
        summary: {
          total: files.length,
          accepted: files.filter((f) => !f.error).length,
          rejected: files.filter((f) => !!f.error).length,
        },
        files: files.map((f) => ({
          fileId: f.fileId || null,
          originalName: f.originalName,
          status: f.error ? 'rejected' : 'uploaded',
          reason: f.error || null,
        })),
      },
    },
    { new: true, upsert: true }
  );
  return doc;
}

async function createJobs({ userId, sessionId, files }) {
  const jobs = [];
  for (const file of files) {
    if (file.error) continue;
    const job = await UserDocumentJob.create({
      jobId: randomUUID(),
      userId,
      sessionId,
      collectionId: file.collectionId ? new mongoose.Types.ObjectId(file.collectionId) : null,
      fileId: file.fileId,
      originalName: file.originalName,
      contentHash: file.contentHash,
      candidateType: null,
      status: 'pending',
      uploadState: 'succeeded',
      processState: 'pending',
      attempts: 0,
      lastError: null,
      schemaVersion: SCHEMA_VERSION,
      parserVersion: resolveParserVersion(),
      promptVersion: resolvePromptVersion(),
      model: resolveModel(),
    });
    jobs.push(job);
  }
  return jobs;
}

async function registerUpload({ userId, sessionId, files }) {
  const sessionDoc = await upsertSession({ userId, sessionId, files });
  const jobs = await createJobs({ userId, sessionId: sessionId || null, files });
  return { session: sessionDoc, jobs };
}

async function setUploadState({ fileId, userId, status, reason }) {
  const update = {};
  if (status === 'rejected') {
    update['files.$.status'] = 'rejected';
    update['files.$.reason'] = reason || null;
  }
  if (Object.keys(update).length) {
    await UploadSession.updateOne({ userId, 'files.fileId': fileId }, { $set: update });
  }
}

async function updateJobState(jobId, patch) {
  await UserDocumentJob.updateOne({ jobId }, { $set: patch });
}

async function markFileStatus({ userId, fileId, status, reason = null }) {
  const update = {
    'files.$.status': status,
  };
  if (reason) update['files.$.reason'] = reason;
  await UploadSession.updateOne({ userId, 'files.fileId': fileId }, { $set: update });
}

async function queueUserFileIds(userId, fileIds) {
  if (!userId) throw new Error('userId is required');
  if (!Array.isArray(fileIds) || fileIds.length === 0) {
    return { queued: 0 };
  }

  const uniqueIds = Array.from(
    new Set(
      fileIds
        .map((id) => (typeof id === 'string' ? id.trim() : ''))
        .filter((id) => id)
    )
  );
  if (!uniqueIds.length) return { queued: 0 };

  let userObjectId;
  try {
    userObjectId = new mongoose.Types.ObjectId(userId);
  } catch (err) {
    throw new Error('Invalid userId');
  }

  const insights = await DocumentInsight.find({ userId: userObjectId, fileId: { $in: uniqueIds } })
    .sort({ updatedAt: -1 })
    .lean();
  const insightByFile = new Map();
  insights.forEach((doc) => {
    if (!insightByFile.has(doc.fileId)) {
      insightByFile.set(doc.fileId, doc);
    }
  });

  const previousJobs = await UserDocumentJob.find({ userId: userObjectId, fileId: { $in: uniqueIds } })
    .sort({ createdAt: -1 })
    .lean();
  const jobByFile = new Map();
  previousJobs.forEach((job) => {
    if (!jobByFile.has(job.fileId)) {
      jobByFile.set(job.fileId, job);
    }
  });

  let queued = 0;
  for (const fileId of uniqueIds) {
    const insight = insightByFile.get(fileId);
    const lastJob = jobByFile.get(fileId);
    if (!insight && !lastJob) continue;

    const schemaVersion = insight?.schemaVersion || lastJob?.schemaVersion || SCHEMA_VERSION;
    const parserVersion =
      resolveParserVersionForCatalogue(insight?.catalogueKey) ||
      lastJob?.parserVersion ||
      resolveParserVersion();
    const contentHash = insight?.contentHash || lastJob?.contentHash;
    if (!contentHash) continue;

    if (insight?._id) {
      await DocumentInsight.deleteOne({ _id: insight._id });
    }

    await UserDocumentJob.create({
      jobId: randomUUID(),
      userId: userObjectId,
      sessionId: lastJob?.sessionId || null,
      collectionId: lastJob?.collectionId || insight?.collectionId || null,
      fileId,
      originalName: lastJob?.originalName || insight?.documentName || fileId,
      contentHash,
      candidateType: null,
      status: 'pending',
      uploadState: 'succeeded',
      processState: 'pending',
      attempts: 0,
      lastError: null,
      schemaVersion,
      parserVersion,
      promptVersion: resolvePromptVersion(),
      model: resolveModel(),
    });

    queued += 1;
  }

  return { queued };
}

module.exports = {
  registerUpload,
  setUploadState,
  updateJobState,
  markFileStatus,
  queueUserFileIds,
};
