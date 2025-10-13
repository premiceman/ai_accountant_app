'use strict';
const express = require('express');
const multer = require('multer');
const dayjs = require('dayjs');
const path = require('path');
const { postDocument, startStandardize, getJob, getStandardization } = require('../services/docupipe.async');
const { putObject, buildObjectKey, keyToFileId } = require('../lib/r2'); // reuse existing helpers

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// POST /api/json-test/submit  (starts work; returns IDs immediately)
router.post('/submit', upload.single('file'), async (req, res) => {
  try {
    if ((process.env.JSON_TEST_USE_DOCUPIPE ?? 'true') === 'false') {
      return res.status(400).json({ ok:false, error:'DocuPipe disabled' });
    }
    const file = req.file;
    if (!file?.buffer) return res.status(400).json({ ok:false, error:'No file uploaded' });

    const docType = (req.body?.docType || process.env.JSON_TEST_DEFAULT_DOC_TYPE || 'bank').toLowerCase();
    const schemaMap = { bank: process.env.DOCUPIPE_BANK_SCHEMA_ID, payslip: process.env.DOCUPIPE_PAYSLIP_SCHEMA_ID };
    const schemaId = schemaMap[docType];
    if (!schemaId) return res.json({ ok:false, error:`Unsupported docType '${docType}' or missing schema env` });

    // Save ORIGINAL to R2 (unchanged)
    const parsedName = path.parse(file.originalname || 'document.pdf');
    const key = buildObjectKey({
      userId: req.user?.id || 'anon',
      userPrefix: 'json-test',
      collectionSegment: 'JSON TEST',
      sessionPrefix: dayjs().format('YYYYMMDD'),
      originalName: parsedName.name || 'document',
      extension: parsedName.ext || '.pdf',
    });
    await putObject({ key, body: file.buffer, contentType: 'application/pdf' });
    const fileId = keyToFileId(key);

    // Start parse
    const { documentId, jobId: parseJobId } = await postDocument({ buffer: file.buffer, filename: file.originalname || 'document.pdf' });

    // Start standardize (no waiting)
    const { jobId: stdJobId, standardizationIds } = await startStandardize({ documentId, schemaId, stdVersion: process.env.DOCUPIPE_STD_VERSION });
    const standardizationId = Array.isArray(standardizationIds) ? standardizationIds[0] : standardizationIds;

    return res.status(202).json({
      ok: true,
      mode: 'async',
      docType,
      schemaId,
      documentId,
      parseJobId,
      stdJobId,
      standardizationId,
      storage: { key, fileId, size: file.size || file.buffer.length }
    });
  } catch (err) {
    return res.json({ ok:false, error: err.message || 'Submit failed', code: err.code || 'DOCUPIPE_ERROR' });
  }
});

// GET /api/json-test/status?stdJobId=...&standardizationId=...
router.get('/status', async (req, res) => {
  try {
    const { stdJobId, standardizationId } = req.query;
    if (!stdJobId || !standardizationId) {
      return res.status(400).json({ ok:false, error:'Missing stdJobId or standardizationId' });
    }

    const job = await getJob(stdJobId);
    if (job?.status === 'failed') return res.json({ ok:false, state:'failed', error: job.error || 'DocuPipe job failed' });
    if (job?.status !== 'completed') return res.json({ ok:true, state:'processing' });

    const std = await getStandardization(standardizationId);
    return res.json({ ok:true, state:'completed', data: std.data });
  } catch (err) {
    return res.json({ ok:false, state:'error', error: err.message || 'Status check failed' });
  }
});

module.exports = router;
