'use strict';

const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const VaultDocument = require('../models/VaultDocument');
const VaultJob = require('../models/VaultJob');
const {
  buildVaultKey,
  createPresignedUpload,
  createPresignedDownload,
  deleteObject,
  sanitizeFilename,
} = require('../services/r2');

const router = express.Router();

router.use(auth);

const MAX_UPLOAD_BYTES = 75 * 1024 * 1024; // 75MB hard limit
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/x-pdf',
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
]);

function getUserObjectId(req) {
  const id = req?.user?.id;
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return null;
  }
  return new mongoose.Types.ObjectId(id);
}

function normalizeContentType(type) {
  if (!type) return 'application/octet-stream';
  const normalized = String(type).toLowerCase();
  if (ALLOWED_TYPES.has(normalized)) return normalized;
  if (normalized.includes('pdf')) return 'application/pdf';
  if (normalized.includes('zip')) return 'application/zip';
  return null;
}

function pipelineSteps(now) {
  const labels = ['Uploaded', 'Queued', 'Classified', 'Standardized', 'Post-Processed', 'Indexed', 'Ready'];
  return labels.map((name, index) => ({
    name,
    status: index === 0 ? 'completed' : index === 1 ? 'running' : 'pending',
    startedAt: index <= 1 ? now : null,
    endedAt: index === 0 ? now : null,
  }));
}

function serializeDocument(doc, job) {
  return {
    id: String(doc._id),
    filename: doc.filename,
    fileSize: doc.fileSize,
    fileType: doc.fileType,
    status: doc.status,
    uploadedAt: doc.uploadedAt,
    pii: doc.pii || {},
    docupipe: doc.docupipe || {},
    deletion: doc.deletion || {},
    job: job
      ? {
          id: String(job._id),
          status: job.status,
          steps: job.steps || [],
          updatedAt: job.updatedAt,
        }
      : null,
  };
}

router.post('/presign-upload', async (req, res, next) => {
  try {
    const userId = getUserObjectId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { filename, contentType, fileSize } = req.body || {};

    if (!filename || typeof filename !== 'string') {
      return res.status(400).json({ error: 'filename is required' });
    }

    const normalizedType = normalizeContentType(contentType);
    if (!normalizedType) {
      return res.status(400).json({ error: 'Unsupported content type' });
    }

    const size = Number(fileSize);
    if (!Number.isFinite(size) || size <= 0) {
      return res.status(400).json({ error: 'fileSize must be a positive number' });
    }
    if (size > MAX_UPLOAD_BYTES) {
      return res.status(413).json({ error: 'File too large' });
    }

    const now = new Date();
    const docId = new mongoose.Types.ObjectId();
    const safeFilename = sanitizeFilename(filename);
    const r2Key = buildVaultKey({
      userId: String(userId),
      documentId: String(docId),
      filename: safeFilename,
    });

    const uploadUrl = await createPresignedUpload({ key: r2Key, contentType: normalizedType });

    await VaultDocument.create({
      _id: docId,
      userId,
      r2Key,
      filename: safeFilename,
      fileSize: size,
      fileType: normalizedType,
      uploadedAt: now,
      status: 'uploaded',
    });

    await VaultJob.create({
      userId,
      documentId: docId,
      type: 'docupipe',
      status: 'queued',
      steps: pipelineSteps(now),
    });

    res.json({ uploadUrl, r2Key, docId: String(docId) });
  } catch (err) {
    next(err);
  }
});

router.get('/list', async (req, res, next) => {
  try {
    const userId = getUserObjectId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      VaultDocument.find({
        userId,
        $or: [
          { 'deletion.deletedAt': { $exists: false } },
          { 'deletion.deletedAt': null },
        ],
      })
        .sort({ uploadedAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean(),
      VaultDocument.countDocuments({
        userId,
        $or: [
          { 'deletion.deletedAt': { $exists: false } },
          { 'deletion.deletedAt': null },
        ],
      }),
    ]);

    const documentIds = items.map((doc) => doc._id);
    const jobs = await VaultJob.find({
      userId,
      documentId: { $in: documentIds },
    })
      .sort({ createdAt: -1 })
      .lean();
    const jobMap = new Map(jobs.map((job) => [String(job.documentId), job]));

    const serialized = items.map((doc) => serializeDocument(doc, jobMap.get(String(doc._id))));

    res.json({
      page,
      pageSize,
      total,
      hasMore: skip + items.length < total,
      items: serialized,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/presign-download/:docId', async (req, res, next) => {
  try {
    const userId = getUserObjectId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { docId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(docId)) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const doc = await VaultDocument.findOne({
      _id: docId,
      userId,
      $or: [
        { 'deletion.deletedAt': { $exists: false } },
        { 'deletion.deletedAt': null },
      ],
    }).lean();

    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const downloadUrl = await createPresignedDownload({ key: doc.r2Key });
    res.json({ downloadUrl });
  } catch (err) {
    next(err);
  }
});

router.delete('/:docId', async (req, res, next) => {
  try {
    const userId = getUserObjectId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { docId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(docId)) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const filter = {
      _id: docId,
      userId,
      $or: [
        { 'deletion.deletedAt': { $exists: false } },
        { 'deletion.deletedAt': null },
      ],
    };

    const doc = await VaultDocument.findOne(filter);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const now = new Date();
    await VaultDocument.updateOne(filter, {
      $set: { 'deletion.requestedAt': now },
    });

    await deleteObject(doc.r2Key).catch((err) => {
      err.status = err.status || 500;
      throw err;
    });

    await Promise.all([
      VaultDocument.updateOne(filter, {
        $set: {
          r2Key: null,
          'deletion.deletedAt': now,
        },
      }),
      VaultJob.updateMany(
        { userId, documentId: doc._id },
        {
          $set: {
            status: 'failed',
            error: 'Deleted by user',
          },
        }
      ),
    ]);

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
