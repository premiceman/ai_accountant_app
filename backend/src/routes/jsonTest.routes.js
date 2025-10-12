'use strict';

const express = require('express');
const multer = require('multer');
const dayjs = require('dayjs');
const auth = require('../../middleware/auth');
const User = require('../../models/User');
const { toBoolean } = require('../../../shared/config/featureFlags');
const {
  putObject,
  buildObjectKey,
  keyToFileId,
} = require('../lib/r2');
const {
  autoAnalyseDocument,
} = require('../services/documents/ingest');
const {
  DocumentProcessingError,
} = require('../services/documents/pipeline/errors');
const { postDocument, waitForJob, standardize, getStandardization } = require('../services/docupipe.standardize');

const JSON_TEST_ENABLED = toBoolean(process.env.JSON_TEST);

const router = express.Router();

if (!JSON_TEST_ENABLED) {
  router.all('*', (_req, res) => res.status(404).json({ error: 'Not found' }));
  module.exports = router;
  return;
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

router.use(auth);

function buildUserContext(userDoc) {
  if (!userDoc) return {};
  const { firstName, lastName, username } = userDoc;
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim() || null;
  const aliases = [];
  if (username) aliases.push(username);
  return {
    fullName,
    firstName: firstName || null,
    lastName: lastName || null,
    username: username || null,
    aliases,
  };
}

router.post('/upload', upload.single('file'), async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const isPdf = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname || '');
    if (!isPdf) {
      return res.status(400).json({ error: 'Only PDF files are supported' });
    }

    const userDoc = await User.findById(userId, 'firstName lastName username').lean();
    const context = { user: buildUserContext(userDoc) };

    const useDocuPipe = (process.env.JSON_TEST_USE_DOCUPIPE ?? 'true') !== 'false' && !!process.env.DOCUPIPE_API_KEY;

    if (useDocuPipe) {
      try {
        const file = req.file;
        if (!file?.buffer) throw new Error('No file uploaded');

        // Map docType -> schemaId (server-side; do not accept raw schemaId from client)
        const allowed = {
          bank:    process.env.DOCUPIPE_BANK_SCHEMA_ID,
          payslip: process.env.DOCUPIPE_PAYSLIP_SCHEMA_ID
        };
        const defaultType = (process.env.JSON_TEST_DEFAULT_DOC_TYPE || 'bank').toLowerCase();
        const docType = (req.body?.docType || defaultType).toLowerCase();
        const schemaId = allowed[docType];
        if (!schemaId) throw new Error(`Unsupported docType '${docType}' or missing schema env`);

        // (1) Save ORIGINAL file to R2 exactly as current code (do not change keys/ids/metadata)
        // existing R2 code here -> yields { key, fileId }
        const key = buildObjectKey({
          userId,
          userPrefix: 'json-test',
          collectionSegment: 'JSON TEST',
          sessionPrefix: dayjs().format('YYYYMMDD'),
          originalName: file.originalname || 'document.pdf',
          extension: '.pdf',
        });
        await putObject({ key, body: file.buffer, contentType: 'application/pdf' });
        const fileId = keyToFileId(key);

        // (2) Upload file to DocuPipe and wait for parse
        const { documentId, jobId } = await postDocument({ buffer: file.buffer, filename: file.originalname || 'document.pdf' });
        await waitForJob(jobId, { timeoutMs: 60000 });

        // (3) Standardize with selected schema and wait for completion
        const { jobId: stdJobId, standardizationIds } = await standardize({ documentId, schemaId, stdVersion: process.env.DOCUPIPE_STD_VERSION });
        await waitForJob(stdJobId, { timeoutMs: 60000 });

        // (4) Fetch standardized JSON
        const stdId = Array.isArray(standardizationIds) ? standardizationIds[0] : null;
        if (!stdId) throw new Error('DocuPipe standardization missing ID');
        const std = await getStandardization(stdId);
        if (!std || typeof std.data === 'undefined') throw new Error('DocuPipe standardization missing data');

        // (5) Return standardized result (bench pretty-prints)
        return res.json({
          ok: true,
          provider: 'docupipe',
          mode: 'direct-standardize',
          docType,
          schemaId,
          data: std.data,
          storage: { key, fileId, size: file.size || file.buffer.length }
        });
      } catch (err) {
        console.warn('[json-test] DocuPipe failed', err);
        return res.json({ ok:false, code: err.code || 'DOCUPIPE_ERROR', error: err.message || 'DocuPipe error' });
      }
    }

    let analysis;
    try {
      analysis = await autoAnalyseDocument(file.buffer, file.originalname || 'document.pdf', context);
    } catch (err) {
      if (err instanceof DocumentProcessingError) {
        console.warn('[json-test] document analysis failed', err);
        return res.status(200).json({
          ok: false,
          error: err.message,
          code: err.code,
        });
      }
      throw err;
    }

    const key = buildObjectKey({
      userId,
      userPrefix: 'json-test',
      collectionSegment: 'JSON TEST',
      sessionPrefix: dayjs().format('YYYYMMDD'),
      originalName: file.originalname || 'document.pdf',
      extension: '.pdf',
    });
    await putObject({ key, body: file.buffer, contentType: 'application/pdf' });
    const fileId = keyToFileId(key);

    res.json({
      ok: true,
      classification: analysis.classification,
      insights: analysis.insights,
      text: analysis.text,
      storage: {
        key,
        fileId,
        size: file.size || file.buffer.length,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
