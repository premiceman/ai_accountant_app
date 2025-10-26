// backend/routes/rag.js
const express = require('express');
const { Types } = require('mongoose');
const { createRateLimiter } = require('../utils/rateLimit');

const Project = require('../models/Project');
const File = require('../models/File');
const auth = require('../middleware/auth');
const { ensureBucket } = require('../utils/gridfs');
const { validate, requireStringId, optionalStringArray, optionalBoolean } = require('../utils/validation');
const { createVectorStore, uploadFileToVectorStore, namespaceForProject } = require('../utils/openai');

const router = express.Router();

const limiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: Number(process.env.RAG_RATE_LIMIT || 10),
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

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

router.post(
  '/projects/:id/rag/index',
  auth,
  limiter,
  validate((params = {}) => ({ id: requireStringId(params.id, 'project id') }), 'params'),
  validate((body = {}) => ({
    fileIds: optionalStringArray(body.fileIds),
    force: optionalBoolean(body.force),
  })),
  async (req, res, next) => {
    try {
      const projectId = asObjectId(req.params.id, 'Invalid project id');
      const project = await ensureProjectOwnership(projectId, req.user.id);

      const filter = { projectId, status: 'clean' };
      if (Array.isArray(req.body.fileIds) && req.body.fileIds.length) {
        const ids = req.body.fileIds.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
        filter._id = { $in: ids };
      }

      const files = await File.find(filter);
      if (!files.length) {
        return res.json({ indexed: [], skipped: [], message: 'No clean files to index' });
      }

      let vectorStoreId = project.openAiVectorStoreId;
      if (!vectorStoreId) {
        const namespace = project.openAiNamespace || namespaceForProject(project._id);
        const created = await createVectorStore(namespace);
        vectorStoreId = created.id;
        project.openAiVectorStoreId = vectorStoreId;
        project.openAiNamespace = created.name || namespace;
        await project.save();
      }

      const bucket = ensureBucket();
      const indexed = [];
      const skipped = [];

      for (const file of files) {
        try {
          if (file.openAiFileId && !req.body.force) {
            skipped.push({ id: file._id, reason: 'Already indexed' });
            continue;
          }
          const downloadStream = bucket.openDownloadStream(file.gridFsId);
          const buffer = await streamToBuffer(downloadStream);
          const uploaded = await uploadFileToVectorStore({
            buffer,
            filename: file.filename,
            mime: file.mime || 'application/octet-stream',
            vectorStoreId,
          });
          file.openAiFileId = uploaded.id;
          file.openAiIndexedAt = new Date();
          file.openAiIndexError = null;
          await file.save();
          indexed.push({ id: file._id, openAiFileId: uploaded.id });
        } catch (err) {
          file.openAiIndexError = err.message || 'Unknown error';
          await file.save();
          skipped.push({ id: file._id, reason: file.openAiIndexError });
        }
      }

      res.json({ indexed, skipped, vectorStoreId });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
