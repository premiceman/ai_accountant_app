'use strict';

const express = require('express');
const { trimBankStatement } = require('../services/pdf/trimBankStatement');
const {
  postDocument,
  startStandardize,
  getJob,
  getStandardization,
} = require('../services/docupipe.async');
const { getObject, putObject, fileIdToKey } = require('../lib/r2');
const { readJsonSafe, writeJsonSafe, paths } = require('../store/jsondb');

const router = express.Router();

const DEFAULT_WARN_PAGES = Number(process.env.VAULT_TRIM_WARN_PAGES || 5) || 5;
const DOCUPIPE_ENABLED = (process.env.VAULT_DOCUPIPE_ENABLED ?? 'true').toLowerCase() !== 'false';

function normaliseDocId(input) {
  return String(input || '').trim();
}

function ensureObject(value, fallback = {}) {
  return value && typeof value === 'object' ? { ...value } : { ...fallback };
}

function arrayWithoutFalsy(list) {
  return Array.isArray(list) ? list.filter(Boolean) : [];
}

async function loadDocuments() {
  return readJsonSafe(paths.docsIndex, []);
}

function matchesDocumentId(doc, docId) {
  const candidates = new Set();
  if (doc?.id != null) candidates.add(normaliseDocId(doc.id));
  if (doc?.docId != null) candidates.add(normaliseDocId(doc.docId));
  if (doc?.documentId != null) candidates.add(normaliseDocId(doc.documentId));
  if (doc?.fileId != null) candidates.add(normaliseDocId(doc.fileId));
  if (doc?.storage?.fileId != null) candidates.add(normaliseDocId(doc.storage.fileId));
  return candidates.has(docId);
}

async function findDocument(docId) {
  const docs = await loadDocuments();
  let index = -1;
  let doc = null;
  for (let i = 0; i < docs.length; i += 1) {
    const entry = docs[i];
    if (!entry || typeof entry !== 'object') continue;
    if (matchesDocumentId(entry, docId)) {
      index = i;
      doc = JSON.parse(JSON.stringify(entry));
      break;
    }
  }
  if (!doc) {
    const err = new Error('DOCUMENT_NOT_FOUND');
    err.statusCode = 404;
    throw err;
  }
  doc.id = normaliseDocId(doc.id || doc.docId || docId);
  return { doc, docs, index };
}

async function persistDocuments(docs) {
  await writeJsonSafe(paths.docsIndex, Array.isArray(docs) ? docs : []);
}

async function saveDocument(doc, docs, index) {
  const next = Array.isArray(docs) ? docs.slice() : [];
  if (index >= 0 && index < next.length) {
    next[index] = doc;
  } else {
    next.push(doc);
  }
  await persistDocuments(next);
  return doc;
}

function resolveOriginalKey(doc) {
  const storage = doc?.storage || {};
  const candidates = arrayWithoutFalsy([
    storage.originalKey,
    storage.original_key,
    storage.key,
    doc?.originalKey,
    doc?.original_key,
    doc?.key,
  ]);
  for (const key of candidates) {
    if (typeof key === 'string' && key.trim()) return key.trim();
  }
  const fileId = storage.fileId || doc?.fileId || doc?.id;
  if (fileId) {
    try {
      return fileIdToKey(fileId);
    } catch (err) {
      return null;
    }
  }
  return null;
}

async function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

async function readR2Buffer(key) {
  const object = await getObject(key);
  const body = object?.Body;
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body);
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body.arrayBuffer === 'function') {
    const arr = await body.arrayBuffer();
    return Buffer.from(arr);
  }
  if (typeof body.pipe === 'function') {
    return streamToBuffer(body);
  }
  throw new Error('UNSUPPORTED_R2_BODY');
}

function updateTrimState(doc, { keptPages, originalPageCount, trimmedKey }) {
  const meta = ensureObject(doc.meta);
  const processing = ensureObject(doc.processing);
  const ui = ensureObject(doc.ui);
  const storage = ensureObject(doc.storage);

  const kept = Array.isArray(keptPages)
    ? keptPages.map((page) => Number(page)).filter((page) => Number.isInteger(page))
    : [];
  const warnThreshold = Number.isFinite(Number(process.env.VAULT_TRIM_WARN_PAGES))
    ? Number(process.env.VAULT_TRIM_WARN_PAGES)
    : DEFAULT_WARN_PAGES;
  const trimRequired = originalPageCount > warnThreshold;

  meta.page_count_original = originalPageCount;
  meta.pages_kept = kept;
  meta.trim_preview_key = trimmedKey;
  meta.trim_required = trimRequired;
  meta.trim_review_state = trimRequired ? 'pending' : 'skipped';

  storage.trimmedKey = trimmedKey;

  processing.provider = 'docupipe';
  processing.status = trimRequired ? 'idle' : 'queued';

  ui.warning = !!trimRequired;
  const existingMessages = Array.isArray(ui.messages) ? ui.messages.slice() : [];
  const trimmedMessage = 'Document trimmed automatically. Review before processing.';
  const filtered = existingMessages.filter((msg) => msg !== trimmedMessage);
  if (trimRequired) filtered.push(trimmedMessage);
  ui.messages = filtered;

  doc.meta = meta;
  doc.processing = processing;
  doc.ui = ui;
  doc.storage = storage;
  doc.updatedAt = new Date().toISOString();
}

function resolveDocumentClass(doc) {
  const metaClass = doc?.meta?.docClass;
  if (typeof metaClass === 'string' && metaClass.trim()) return metaClass.trim();
  const direct = doc?.docClass || doc?.classification?.docClass;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  return null;
}

function resolveFilename(doc) {
  const storage = doc?.storage || {};
  const candidates = arrayWithoutFalsy([
    doc?.originalName,
    doc?.name,
    storage.originalName,
    storage.displayName,
    'document.pdf',
  ]);
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'string') return candidate;
  }
  return 'document.pdf';
}

async function writeJsonToR2(key, data) {
  const payload = Buffer.from(JSON.stringify(data, null, 2), 'utf8');
  await putObject({ key, body: payload, contentType: 'application/json' });
}

function ensureProcessing(doc, schemaId) {
  const processing = ensureObject(doc.processing);
  processing.provider = 'docupipe';
  processing.status = 'processing';
  if (schemaId) processing.schemaId = schemaId;
  return processing;
}

function ensureResult(doc) {
  const result = ensureObject(doc.result);
  if (!Array.isArray(result.messages)) result.messages = Array.isArray(result.messages) ? result.messages : [];
  return result;
}

router.post('/autotrim', async (req, res) => {
  try {
    const docId = normaliseDocId(req.body?.docId);
    if (!docId) {
      return res.status(400).json({ ok: false, error: 'DOC_ID_REQUIRED' });
    }
    const { doc, docs, index } = await findDocument(docId);
    const originalKey = resolveOriginalKey(doc);
    if (!originalKey) {
      return res.status(400).json({ ok: false, error: 'ORIGINAL_KEY_MISSING' });
    }

    const buffer = await readR2Buffer(originalKey);
    if (!buffer || !buffer.length) {
      return res.status(400).json({ ok: false, error: 'ORIGINAL_FILE_EMPTY' });
    }

    const { buffer: trimmedBuffer, keptPages, originalPageCount } = await trimBankStatement(buffer, {
      minScore: Number(process.env.BANK_PDF_TRIM_MIN_SCORE ?? 5) || 5,
    });

    const trimmedKey = `${originalKey}.trimmed.pdf`;
    await putObject({ key: trimmedKey, body: trimmedBuffer, contentType: 'application/pdf' });

    updateTrimState(doc, { keptPages, originalPageCount, trimmedKey });

    await saveDocument(doc, docs, index);

    res.json({
      ok: true,
      trim: { keptPages, originalPageCount },
      trimRequired: !!doc.meta?.trim_required,
    });
  } catch (err) {
    const status = err?.statusCode || err?.status || 500;
    res.status(status).json({ ok: false, error: err?.message || 'AUTOTRIM_FAILED' });
  }
});

router.post('/process', async (req, res) => {
  try {
    if (!DOCUPIPE_ENABLED) {
      return res.status(400).json({ ok: false, error: 'DOCUPIPE_DISABLED' });
    }
    const docId = normaliseDocId(req.body?.docId);
    if (!docId) {
      return res.status(400).json({ ok: false, error: 'DOC_ID_REQUIRED' });
    }
    const { doc, docs, index } = await findDocument(docId);
    const docClass = resolveDocumentClass(doc);
    if (!docClass) {
      return res.status(400).json({ ok: false, error: 'DOC_CLASS_UNKNOWN' });
    }
    const allowed = new Set(['bank_statement', 'payslip']);
    if (!allowed.has(docClass)) {
      return res.status(400).json({ ok: false, error: 'UNSUPPORTED_DOC_CLASS' });
    }

    const schemaMap = {
      bank_statement: process.env.DOCUPIPE_BANK_SCHEMA_ID,
      payslip: process.env.DOCUPIPE_PAYSLIP_SCHEMA_ID,
    };
    const schemaId = schemaMap[docClass];
    if (!schemaId) {
      return res.status(400).json({ ok: false, error: 'SCHEMA_ID_MISSING' });
    }

    const sourceKey = doc?.meta?.trim_preview_key || doc?.storage?.trimmedKey || resolveOriginalKey(doc);
    if (!sourceKey) {
      return res.status(400).json({ ok: false, error: 'SOURCE_KEY_MISSING' });
    }

    const buffer = await readR2Buffer(sourceKey);
    if (!buffer || !buffer.length) {
      return res.status(400).json({ ok: false, error: 'SOURCE_FILE_EMPTY' });
    }

    const filename = resolveFilename(doc);
    const { documentId, jobId: parseJobId } = await postDocument({ buffer, filename });
    const { jobId: stdJobId, standardizationIds } = await startStandardize({
      documentId,
      schemaId,
      stdVersion: process.env.DOCUPIPE_STD_VERSION || undefined,
    });
    const standardizationId = Array.isArray(standardizationIds) ? standardizationIds[0] : standardizationIds;
    if (!standardizationId) {
      return res.status(500).json({ ok: false, error: 'STANDARDIZATION_ID_MISSING' });
    }

    const processing = ensureProcessing(doc, schemaId);
    processing.documentId = documentId;
    processing.parseJobId = parseJobId;
    processing.stdJobId = stdJobId;
    processing.standardizationId = standardizationId;
    processing.startedAt = new Date().toISOString();

    const result = ensureResult(doc);
    result.schemaId = schemaId;

    doc.processing = processing;
    doc.result = result;
    doc.storage = ensureObject(doc.storage);
    doc.storage.lastSourceKey = sourceKey;
    doc.updatedAt = new Date().toISOString();

    await saveDocument(doc, docs, index);

    res.status(202).json({
      ok: true,
      docId: doc.id,
      stdJobId,
      standardizationId,
    });
  } catch (err) {
    const status = err?.statusCode || err?.status || 500;
    res.status(status).json({ ok: false, error: err?.message || 'PROCESS_FAILED' });
  }
});

router.get('/status', async (req, res) => {
  try {
    const docId = normaliseDocId(req.query?.docId);
    if (!docId) {
      return res.status(400).json({ ok: false, error: 'DOC_ID_REQUIRED' });
    }
    const { doc, docs, index } = await findDocument(docId);
    const processing = doc?.processing || {};
    const stdJobId = processing.stdJobId;
    const standardizationId = processing.standardizationId;
    if (!stdJobId) {
      return res.json({ ok: false, error: 'NO_JOB' });
    }

    const job = await getJob(stdJobId);
    if (!job || job.status === 'processing' || !job.status) {
      return res.json({ ok: true, state: 'processing' });
    }

    if (job.status === 'failed') {
      const failure = ensureObject(doc.processing);
      failure.status = 'failed';
      failure.error = job.error || 'DocuPipe job failed';
      failure.updatedAt = new Date().toISOString();
      doc.processing = failure;
      await saveDocument(doc, docs, index);
      return res.json({ ok: false, state: 'failed', error: failure.error });
    }

    if (!standardizationId) {
      return res.json({ ok: false, state: 'failed', error: 'STANDARDIZATION_ID_MISSING' });
    }

    const std = await getStandardization(standardizationId);
    if (!std || typeof std.data === 'undefined') {
      return res.json({ ok: false, state: 'failed', error: 'STANDARDIZATION_DATA_MISSING' });
    }

    const originalKey = resolveOriginalKey(doc);
    if (!originalKey) {
      return res.json({ ok: false, state: 'failed', error: 'ORIGINAL_KEY_MISSING' });
    }

    const jsonKey = `${originalKey}.std.json`;
    await writeJsonToR2(jsonKey, std.data);

    const processingState = ensureObject(doc.processing);
    processingState.status = 'completed';
    processingState.completedAt = new Date().toISOString();
    processingState.error = null;

    const result = ensureResult(doc);
    result.schemaId = result.schemaId || processingState.schemaId || null;
    result.json_key = jsonKey;
    result.json_fetched_at = new Date().toISOString();

    const storage = ensureObject(doc.storage);
    storage.jsonKey = jsonKey;

    doc.processing = processingState;
    doc.result = result;
    doc.storage = storage;
    doc.updatedAt = new Date().toISOString();

    await saveDocument(doc, docs, index);

    res.json({ ok: true, state: 'completed' });
  } catch (err) {
    const status = err?.statusCode || err?.status || 500;
    res.status(status).json({ ok: false, error: err?.message || 'STATUS_FAILED' });
  }
});

router.get('/json', async (req, res) => {
  try {
    const docId = normaliseDocId(req.query?.docId);
    if (!docId) {
      return res.status(400).json({ ok: false, error: 'DOC_ID_REQUIRED' });
    }
    const { doc } = await findDocument(docId);
    const key = doc?.result?.json_key || doc?.storage?.jsonKey;
    if (!key) {
      return res.json({ ok: false, error: 'JSON_NOT_READY' });
    }
    const buffer = await readR2Buffer(key);
    if (!buffer || !buffer.length) {
      return res.json({ ok: false, error: 'JSON_NOT_READY' });
    }
    let parsed;
    try {
      parsed = JSON.parse(buffer.toString('utf8'));
    } catch (err) {
      return res.json({ ok: false, error: 'JSON_PARSE_FAILED' });
    }
    res.json({ ok: true, json: parsed });
  } catch (err) {
    const status = err?.statusCode || err?.status || 500;
    res.status(status).json({ ok: false, error: err?.message || 'JSON_FETCH_FAILED' });
  }
});

module.exports = router;
