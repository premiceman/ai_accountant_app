const { randomUUID } = require('crypto');
const mongoose = require('mongoose');
const UserDocumentJob = require('../../../models/UserDocumentJob');
const UploadSession = require('../../../models/UploadSession');

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

module.exports = {
  registerUpload,
  setUploadState,
  updateJobState,
  markFileStatus,
};
