// backend/src/routes/documents.routes.js
// Documents API using GridFS (bytes) + JSON index for listings.
// Enforces per-user access: users can only view, upload, stream, and delete their OWN files.

const express = require('express');
const multer = require('multer');

const auth = require('../../middleware/auth');
const {
  saveBufferToGridFS,
  listFiles,
  streamFileById,
  deleteFileById,
  assertUserOwnsFile,
} = require('../services/documents/storage.service');

const { paths, readJsonSafe, writeJsonSafe } = require('../store/jsondb');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// Require auth for ALL document routes
router.use(auth);

/**
 * GET /api/documents
 * Optional query: ?type=&year=
 * Returns ONLY the caller's own files.
 */
router.get('/', async (req, res) => {
  try {
    const userId = String(req.user.id);
    const { type, year } = req.query || {};

    // Source of truth: GridFS (authoritative)
    const files = await listFiles({ userId, type, year });

    // Keep index compatibility & shape
    const index = await readJsonSafe(paths.docsIndex, []);
    const byId = new Map(index.filter(r => String(r.userId) === userId).map(r => [String(r.id), r]));
    const merged = files.map(f => {
      const idx = byId.get(String(f.id)) || {};
      return {
        id: f.id,
        type: f.type ?? idx.type ?? null,
        filename: f.filename || idx.filename,
        storedAs: idx.storedAs || f.id,
        length: f.length,
        mime: f.mime,
        uploadDate: f.uploadDate,
        year: f.year ?? idx.year ?? null,
      };
    });

    res.json({ files: merged });
  } catch (e) {
    console.error('GET /api/documents error:', e);
    res.status(500).json({ error: 'Failed to list documents' });
  }
});

/**
 * POST /api/documents?type=&year=
 * Body: multipart/form-data, file field name = "file"
 * Saves file owned by the caller; adds to JSON index (per-user).
 */
router.post('/', upload.single('file'), async (req, res) => {
  try {
    const userId = String(req.user.id);
    const { type = null, year = null } = req.query || {};
    if (!req.file) return res.status(400).json({ error: 'Missing file' });

    const buffer = req.file.buffer;
    const originalName = req.file.originalname || 'upload.bin';
    const contentType = req.file.mimetype || 'application/octet-stream';

    const saved = await saveBufferToGridFS(buffer, originalName, {
      contentType,
      metadata: { userId, type, year, mime: contentType },
    });

    // Append to JSON index with owner field
    const index = await readJsonSafe(paths.docsIndex, []);
    index.push({
      id: saved.id,
      userId,
      type,
      filename: originalName,
      storedAs: saved.id,
      length: saved.length,
      mime: contentType,
      uploadDate: saved.uploadDate,
      year,
    });
    await writeJsonSafe(paths.docsIndex, index);

    res.status(201).json({
      id: saved.id,
      filename: originalName,
      mime: contentType,
      length: saved.length,
      uploadDate: saved.uploadDate,
      type,
      year,
    });
  } catch (e) {
    console.error('POST /api/documents error:', e);
    res.status(500).json({ error: 'Failed to upload document' });
  }
});

/**
 * DELETE /api/documents/:id
 * Deletes ONLY if owned by the caller; prunes index accordingly.
 */
router.delete('/:id', async (req, res) => {
  try {
    const userId = String(req.user.id);
    const { id } = req.params;

    await deleteFileById(id, userId);

    const index = await readJsonSafe(paths.docsIndex, []);
    const next = index.filter(r => !(String(r.id) === String(id) && String(r.userId) === userId));
    await writeJsonSafe(paths.docsIndex, next);

    res.json({ ok: true });
  } catch (e) {
    if (e && e.code === 404) return res.status(404).json({ error: 'Not found' });
    console.error('DELETE /api/documents/:id error:', e);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

/**
 * GET /api/documents/:id/stream
 * Streams ONLY if file belongs to the caller.
 */
// ...existing imports and setup above...

// GET /api/documents/:id/stream
router.get('/:id/stream', async (req, res) => {
  try {
    const userId = String(req.user.id);
    const { id } = req.params;

    // Validate ownership; returns GridFS files doc
    const fileDoc = await assertUserOwnsFile(id, userId);

    const ct = fileDoc?.contentType || 'application/octet-stream';
    const fname = (fileDoc?.filename || 'download').replace(/"/g, '');
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');

    // Let browsers/iframe render PDFs inline; other types can still download client-side
    if (ct.startsWith('application/pdf')) {
      res.setHeader('Content-Disposition', `inline; filename="${fname}"`);
    } else {
      // No Content-Disposition header here; front-end forces download via Blob
    }

    const stream = streamFileById(id);
    stream.on('error', () => res.sendStatus(404));
    stream.pipe(res);
  } catch (e) {
    if (e && e.code === 404) return res.sendStatus(404);
    console.error('GET /api/documents/:id/stream error:', e);
    res.sendStatus(500);
  }
});



module.exports = router;
