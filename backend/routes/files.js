// backend/routes/files.js
const express = require('express');
const multer = require('multer');
const { Types } = require('mongoose');
const { pipeline, Readable } = require('stream');
const { promisify } = require('util');
const { createRateLimiter } = require('../utils/rateLimit');

const File = require('../models/File');
const Project = require('../models/Project');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const auth = require('../middleware/auth');
const { ensureBucket } = require('../utils/gridfs');
const { validate, requireStringId } = require('../utils/validation');

const asyncPipeline = promisify(pipeline);

const upload = multer({ storage: multer.memoryStorage() });

const MAX_FILE_BYTES = Number(process.env.FILE_UPLOAD_MAX_BYTES || 15 * 1024 * 1024);
const ALLOWED_MIME_TYPES = (process.env.FILE_ALLOWED_MIME || 'application/pdf,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document').split(',');

const router = express.Router();

const limiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: Number(process.env.FILE_RATE_LIMIT || 20),
});

function asObjectId(value, message) {
  if (!Types.ObjectId.isValid(value)) {
    throw new Error(message);
  }
  return new Types.ObjectId(value);
}

async function ensureProjectOwnership(projectId, userId) {
  const project = await Project.findById(projectId);
  if (!project) {
    const err = new Error('Project not found');
    err.status = 404;
    throw err;
  }
  if (String(project.ownerId) !== String(userId)) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
  return project;
}

function fileMetadataResponse(fileDoc) {
  return {
    id: fileDoc._id,
    projectId: fileDoc.projectId,
    filename: fileDoc.filename,
    length: fileDoc.length,
    chunkSize: fileDoc.chunkSize,
    uploadDate: fileDoc.uploadDate,
    md5: fileDoc.md5,
    mime: fileDoc.mime,
    status: fileDoc.status,
    openAiFileId: fileDoc.openAiFileId,
    openAiIndexedAt: fileDoc.openAiIndexedAt,
    openAiIndexError: fileDoc.openAiIndexError,
    createdAt: fileDoc.createdAt,
    updatedAt: fileDoc.updatedAt,
  };
}

router.post(
  '/projects/:id/files',
  auth,
  limiter,
  validate((params = {}) => ({ id: requireStringId(params.id, 'project id') }), 'params'),
  upload.single('file'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const projectId = asObjectId(id, 'Invalid project id');
      await ensureProjectOwnership(projectId, req.user.id);

      if (!req.file) {
        return res.status(400).json({ error: 'File is required' });
      }
      const file = req.file;

      if (file.size > MAX_FILE_BYTES) {
        return res.status(400).json({ error: 'File too large' });
      }

      if (ALLOWED_MIME_TYPES.length && !ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        return res.status(400).json({ error: 'Unsupported file type' });
      }

      const bucket = ensureBucket();
      const stream = bucket.openUploadStream(file.originalname, {
        contentType: file.mimetype,
        metadata: {
          ownerId: req.user.id,
          projectId: id,
        },
      });

      await asyncPipeline(Readable.from(file.buffer), stream);

      const storedFile = await bucket.find({ _id: stream.id }).next();
      if (!storedFile) {
        throw new Error('Failed to persist file metadata');
      }

      const doc = await File.create({
        projectId,
        ownerId: req.user.id,
        filename: storedFile.filename,
        length: storedFile.length,
        chunkSize: storedFile.chunkSize,
        uploadDate: storedFile.uploadDate,
        md5: storedFile.md5 || null,
        mime: storedFile.contentType,
        status: 'pending',
        gridFsId: storedFile._id,
      });

      res.status(201).json({ file: fileMetadataResponse(doc) });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/projects/:id/files',
  auth,
  limiter,
  validate((params = {}) => ({ id: requireStringId(params.id, 'project id') }), 'params'),
  async (req, res, next) => {
    try {
      const projectId = asObjectId(req.params.id, 'Invalid project id');
      await ensureProjectOwnership(projectId, req.user.id);
      const files = await File.find({ projectId }).sort({ createdAt: -1 });
      res.json({ files: files.map(fileMetadataResponse) });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/files/:fileId/download',
  auth,
  limiter,
  validate((params = {}) => ({ fileId: requireStringId(params.fileId, 'file id') }), 'params'),
  async (req, res, next) => {
    try {
      const fileId = asObjectId(req.params.fileId, 'Invalid file id');
      const fileDoc = await File.findById(fileId);
      if (!fileDoc) {
        return res.status(404).json({ error: 'File not found' });
      }
      if (String(fileDoc.ownerId) !== String(req.user.id)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const bucket = ensureBucket();
      const downloadStream = bucket.openDownloadStream(fileDoc.gridFsId);
      downloadStream.on('error', (err) => next(err));

      res.setHeader('Content-Type', fileDoc.mime || 'application/octet-stream');
      res.setHeader('Content-Length', fileDoc.length);
      res.setHeader('Content-Disposition', `attachment; filename="${fileDoc.filename}"`);

      AuditLog.create({
        actorId: req.user.id,
        action: 'file_download',
        targetType: 'file',
        targetId: fileDoc._id.toString(),
        metadata: { filename: fileDoc.filename },
        ip: req.ip,
        ua: req.headers['user-agent'] || null,
      }).catch(() => {});

      downloadStream.pipe(res);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/files/:fileId/scan',
  auth,
  limiter,
  validate((params = {}) => ({ fileId: requireStringId(params.fileId, 'file id') }), 'params'),
  validate((body = {}) => {
    const status = body.status;
    if (status !== 'clean' && status !== 'quarantined') {
      const err = new Error('Invalid status');
      err.status = 400;
      throw err;
    }
    return { status };
  }),
  async (req, res, next) => {
    try {
      const fileId = asObjectId(req.params.fileId, 'Invalid file id');
      const user = await User.findById(req.user.id);
      if (!user || !Array.isArray(user.roles) || !user.roles.includes('admin')) {
        return res.status(403).json({ error: 'Admin required' });
      }

      const fileDoc = await File.findById(fileId);
      if (!fileDoc) {
        return res.status(404).json({ error: 'File not found' });
      }

      fileDoc.status = req.body.status;
      if (req.body.status === 'clean') {
        fileDoc.openAiIndexError = null;
      }
      await fileDoc.save();

      res.json({ file: fileMetadataResponse(fileDoc) });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
