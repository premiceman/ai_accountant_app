const express = require('express');
const { randomUUID } = require('crypto');
const DeadLetterJob = require('../models/DeadLetterJob');
const UploadBatch = require('../models/UploadBatch');
const IngestJob = require('../models/IngestJob');
const { objectKeyForUpload } = require('../services/r2');
const { enqueueJob } = require('../services/ingestion/jobProcessor');

const router = express.Router();

router.post('/dead-letters/:id/requeue', async (req, res, next) => {
  try {
    const { id } = req.params;
    const dead = await DeadLetterJob.findOne({ _id: id, userId: req.user.id });
    if (!dead) {
      return res.status(404).json({ error: 'Dead letter not found' });
    }
    const batch = await UploadBatch.findOne({ userId: req.user.id, $or: [
      { 'files.fileId': dead.fileId },
      { 'files.children.fileId': dead.fileId },
    ] });
    if (!batch) {
      return res.status(404).json({ error: 'Source batch missing' });
    }
    let file = batch.files.find((f) => f.fileId === dead.fileId);
    if (!file) {
      const parent = batch.files.find((f) => (f.children || []).some((child) => child.fileId === dead.fileId));
      if (!parent) {
        return res.status(404).json({ error: 'Source file missing' });
      }
      const childKey = objectKeyForUpload({
        userId: req.user.id,
        batchId: batch.batchId,
        fileId: dead.fileId,
        filename: `${dead.fileId}.pdf`,
      });
      // ensure R2 key exists by reusing parent prefix when possible
      const existingChild = (parent.children || []).find((c) => c.fileId === dead.fileId);
      const r2Key = existingChild?.r2Key || parent.r2Key?.replace(parent.fileId, dead.fileId) || childKey;
      file = { fileId: dead.fileId, r2Key, typeHint: parent.typeHint };
    }
    const jobDoc = await IngestJob.create({
      userId: req.user.id,
      jobId: randomUUID(),
      batchId: batch.batchId,
      fileId: file.fileId,
      r2Key: file.r2Key,
      typeHint: file.typeHint,
      status: 'queued',
      attempts: 0,
    });
    const fileEntry = batch.files.find((f) => f.fileId === file.fileId) || batch.files.find((f) => (f.children || []).some((c) => c.fileId === file.fileId));
    if (fileEntry) {
      if (fileEntry.fileId === file.fileId) {
        fileEntry.status = 'queued';
        fileEntry.message = 'Retrying';
        fileEntry.updatedAt = new Date();
      }
      const childEntry = (fileEntry.children || []).find((c) => c.fileId === file.fileId);
      if (childEntry) {
        childEntry.status = 'queued';
        childEntry.message = 'Retrying';
        childEntry.updatedAt = new Date();
      }
      await batch.save();
    }
    await DeadLetterJob.deleteOne({ _id: id });
    enqueueJob(jobDoc).catch((error) => {
      console.error('Failed to run requeued job', error);
    });
    res.json({ jobId: jobDoc.jobId });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
