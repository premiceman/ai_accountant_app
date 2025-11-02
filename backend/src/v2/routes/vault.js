const express = require('express');
const { randomUUID } = require('crypto');
const UploadBatch = require('../models/UploadBatch');
const IngestJob = require('../models/IngestJob');
const { objectKeyForUpload, createPresignedPut } = require('../services/r2');
const { enqueueJob } = require('../services/ingestion/jobProcessor');
const DeadLetterJob = require('../models/DeadLetterJob');

const router = express.Router();

const ALLOWED_TYPES = new Set(['application/pdf', 'application/zip']);

function normaliseContentType(contentType, filename = '') {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('pdf')) return 'application/pdf';
  if (ct.includes('zip')) return 'application/zip';
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.zip')) return 'application/zip';
  return ct;
}

function assertAllowedType(contentType) {
  if (!ALLOWED_TYPES.has(contentType)) {
    const error = new Error('Only PDF or ZIP uploads are supported');
    error.statusCode = 400;
    throw error;
  }
}

router.post('/presign', async (req, res, next) => {
  try {
    const { filename, contentType, size, batchId: batchIdInput, typeHint } = req.body || {};
    if (!filename || !size) {
      return res.status(400).json({ error: 'filename and size required' });
    }
    const batchId = batchIdInput || randomUUID();
    const fileId = randomUUID();
    const safeContentType = normaliseContentType(contentType, filename);
    assertAllowedType(safeContentType);
    const key = objectKeyForUpload({
      userId: req.user.id,
      batchId,
      fileId,
      filename,
    });
    const presign = await createPresignedPut({ key, contentType: safeContentType || 'application/octet-stream', contentLength: size });

    const batch = await UploadBatch.findOne({ batchId, userId: req.user.id });
    if (batch) {
      batch.files.push({ fileId, filename, contentType: safeContentType, size, status: 'pending', typeHint, r2Key: key });
      await batch.save();
    } else {
      await UploadBatch.create({
        userId: req.user.id,
        batchId,
        files: [{ fileId, filename, contentType: safeContentType, size, status: 'pending', typeHint, r2Key: key }],
      });
    }

    res.json({ batchId, fileId, upload: presign });
  } catch (error) {
    next(error);
  }
});

router.post('/ingest', async (req, res, next) => {
  try {
    const { batchId, files } = req.body || {};
    if (!batchId || !Array.isArray(files) || !files.length) {
      return res.status(400).json({ error: 'batchId and files required' });
    }
    const batch = await UploadBatch.findOne({ batchId, userId: req.user.id });
    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }
    batch.status = 'processing';
    await batch.save();
    const queued = [];
    for (const file of files) {
      const entry = batch.files.find((f) => f.fileId === file.fileId);
      if (!entry) continue;
      if (file.typeHint) entry.typeHint = file.typeHint;
      entry.status = 'queued';
      await batch.save();
      const jobDoc = await IngestJob.create({
        userId: req.user.id,
        jobId: randomUUID(),
        batchId,
        fileId: entry.fileId,
        r2Key: entry.r2Key,
        typeHint: entry.typeHint,
        status: 'queued',
        attempts: 0,
      });
      enqueueJob(jobDoc).catch((error) => {
        console.error('Failed to run ingest job', error);
      });
      queued.push({ fileId: entry.fileId, jobId: jobDoc.jobId });
    }
    res.json({ queued });
  } catch (error) {
    next(error);
  }
});

router.get('/files', async (req, res, next) => {
  try {
    const batches = await UploadBatch.find({ userId: req.user.id }).sort({ createdAt: -1 }).lean();
    const deadLetters = await DeadLetterJob.find({ userId: req.user.id }).lean();
    res.json({ batches, deadLetters });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
