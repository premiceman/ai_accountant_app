// backend/src/routes/documents.routes.js
// Documents API using GridFS for file bytes, and a JSON index for quick listing.
// Keeps the existing API contract that your frontend expects.

const express = require('express');
const multer = require('multer');
const path = require('path');
const {
  saveBufferToGridFS,
  deleteFileById,
  listFiles,
  streamFileById,
} = require('../services/documents/storage.service');

// JSON "DB" helpers you already use
const { paths, readJsonSafe, writeJsonSafe } = require('../store/jsondb');

// Multer in-memory storage (Render-safe)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

// Helper: load & save your index (keeps { files: [...] } contract)
async function loadIndex() {
  return await readJsonSafe(paths.docsIndex, { files: [] });
}
async function saveIndex(index) {
  await writeJsonSafe(paths.docsIndex, index);
}

// Resolve userId if your auth middleware attaches req.user;
// otherwise this remains undefined (we still work).
function getUserId(req) {
  return req.user?.id || req.user?._id || undefined;
}

const router = express.Router();

/**
 * GET /api/documents
 * GET /api/docs           (alias via docs.routes.js below)
 * -> { files: [...] }
 */
router.get('/', async (req, res, next) => {
  try {
    // Keep using the JSON index for speed and backward-compat
    // (If you want per-user isolation later, filter here using req.user)
    const idx = await loadIndex();
    res.json(idx);
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/documents?type=foo&year=2025
 * POST /api/docs?type=foo&year=2025
 * Form field: "file"
 */
router.post('/', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file' });

    const type = String(req.query.type || 'other').trim();
    const year = req.query.year ? Number(req.query.year) : undefined;
    const userId = getUserId(req);

    // Save bytes to GridFS
    const id = await saveBufferToGridFS(file.buffer, file.originalname, {
      userId: userId ? String(userId) : undefined,
      type,
      year,
      mime: file.mimetype,
    });

    // Record in JSON index with the same shape your FE uses
    const idx = await loadIndex();
    const record = {
      id: String(id),
      type,
      filename: file.originalname,
      storedAs: String(id), // now the GridFS id (used only for display)
      length: file.size,
      mime: file.mimetype,
      uploadDate: new Date().toISOString(),
    };
    idx.files.unshift(record);
    await saveIndex(idx);

    res.status(201).json({ ok: true, file: record });
  } catch (e) {
    console.error('upload error:', e);
    res.status(500).json({ error: 'Upload failed' });
  }
});

/**
 * DELETE /api/documents/:id
 * DELETE /api/docs/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = getUserId(req);

    // Remove from GridFS
    try {
      await deleteFileById(id, userId);
    } catch (e) {
      if (e?.code !== 404) throw e;
      // If not found in GridFS, we still continue to clean JSON index.
    }

    // Remove from JSON index
    const idx = await loadIndex();
    const i = idx.files.findIndex((f) => String(f.id) === String(id));
    if (i !== -1) idx.files.splice(i, 1);
    await saveIndex(idx);

    res.json({ ok: true });
  } catch (e) {
    console.error('delete error:', e);
    res.status(500).json({ error: 'Delete failed' });
  }
});

/**
 * (Optional) GET /api/documents/:id/stream
 * Useful if you later want to preview/download directly from GridFS.
 */
router.get('/:id/stream', async (req, res) => {
  try {
    const stream = streamFileById(req.params.id);
    stream.on('file', (file) => {
      if (file?.contentType) res.setHeader('Content-Type', file.contentType);
      res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    });
    stream.on('error', () => res.sendStatus(404));
    stream.pipe(res);
  } catch {
    res.sendStatus(404);
  }
});

module.exports = router;
