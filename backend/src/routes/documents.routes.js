// backend/src/routes/documents.routes.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const multer = require('multer');
const { paths, readJsonSafe, writeJsonSafe } = require('../store/jsondb');

const router = express.Router();

// storage under /uploads/<type>/
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const type = String(req.query.type || 'other').trim();
    const dir = path.join(paths.uploadsDir, type);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ts = Date.now();
    const safe = file.originalname.replace(/[^\w.\-]+/g, '_');
    cb(null, `${ts}_${safe}`);
  }
});
const upload = multer({ storage });

// helpers
async function loadIndex() {
  return await readJsonSafe(paths.docsIndex, { files: [] });
}
async function saveIndex(index) {
  await writeJsonSafe(paths.docsIndex, index);
}

// GET /api/docs  -> { files: [...] }
router.get('/', async (_req, res) => {
  const idx = await loadIndex();
  res.json(idx);
});

// POST /api/docs?type=foo&year=2025
router.post('/', upload.single('file'), async (req, res) => {
  try {
    const type = String(req.query.type || 'other').trim();
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file' });

    const idx = await loadIndex();
    const record = {
      id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
      type,
      filename: file.originalname,
      storedAs: path.relative(paths.uploadsDir, file.path),
      length: file.size,
      mime: file.mimetype,
      uploadDate: new Date().toISOString()
    };
    idx.files.unshift(record);
    await saveIndex(idx);

    res.json({ ok: true, file: record });
  } catch (e) {
    console.error('upload error:', e);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// DELETE /api/docs/:id
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const idx = await loadIndex();
  const i = idx.files.findIndex(f => f.id === id);
  if (i === -1) return res.status(404).json({ error: 'Not found' });

  const rec = idx.files[i];
  const abs = path.join(paths.uploadsDir, rec.storedAs || '');
  try { await fsp.unlink(abs); } catch {}
  idx.files.splice(i, 1);
  await saveIndex(idx);
  res.json({ ok: true });
});

module.exports = router;

