/*// backend/src/routes/documents.routes.js
const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const multer = require('multer');
const {
  saveBufferToGridFS,
  listFiles,
  deleteFileById
} = require('../services/documents/storage.service');

const MAX_UPLOAD_MB = parseInt(process.env.MAX_UPLOAD_MB || '20', 10);
const upload = multer({
  storage: multer.memoryStorage(),                   // so req.file.buffer exists
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 }  // configurable limit
});

// POST /api/docs (field: file, ?type, ?year)
router.post('/', auth, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: `File too large. Max ${MAX_UPLOAD_MB} MB` });
      }
      return res.status(400).json({ error: err.message || 'Upload error' });
    }

    try {
      if (!req.file) return res.status(400).json({ error: 'No file' });

      const type = String(req.query.type || 'other');
      const year = req.query.year ? Number(req.query.year) : undefined;

      const id = await saveBufferToGridFS(req.file.buffer, req.file.originalname, {
        userId: String(req.user.id),
        type, year, uploadedAt: new Date()
      });

      res.json({ ok: true, id, maxUploadMb: MAX_UPLOAD_MB });
    } catch (e) {
      console.error('Upload error:', e);
      res.status(500).json({ error: 'Upload failed' });
    }
  });
});

// GET /api/docs
router.get('/', auth, async (req, res) => {
  const files = await listFiles(req.user.id);
  const mapped = files.map(f => ({
    id: f._id,
    filename: f.filename,
    length: f.length,
    uploadDate: f.uploadDate,
    type: f.metadata?.type || 'other',
    year: f.metadata?.year || null
  }));
  res.json({ files: mapped });
});

// Optional helper: what the app expects (not required by the new UI, but harmless)
router.get('/expected', auth, async (req, res) => {
  res.json({ required: [] });
});

// DELETE /api/docs/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    await deleteFileById(req.params.id, req.user.id);
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 404) return res.status(404).json({ error: 'Not found' });
    console.error('Delete error:', e);
    res.status(500).json({ error: 'Delete failed' });
  }
});

module.exports = router;*/

// backend/src/routes/docs.routes.js
// Fast, streaming uploads via multer (multipart/form-data).
// Stores files on disk (backend/uploads/) and metadata in a tiny JSON db (backend/storage/docs.json)

const express = require('express');
const multer = require('multer');
const fs = require('fs/promises');
const fscb = require('fs');
const path = require('path');
const crypto = require('crypto');

const router = express.Router();

// --- paths
const ROOT = path.join(__dirname, '..', '..');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const DB_DIR = path.join(ROOT, 'storage');
const DB_PATH = path.join(DB_DIR, 'docs.json');

// --- ensure folders exist
async function ensureDirs() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.mkdir(DB_DIR, { recursive: true });
}
ensureDirs().catch(() => {});

// --- tiny json db helpers
async function readDB() {
  try {
    const raw = await fs.readFile(DB_PATH, 'utf8');
    return JSON.parse(raw || '{"files":[]}');
  } catch {
    return { files: [] };
  }
}
async function writeDB(db) {
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

// --- multer disk storage (stream to disk, no memory buffering)
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const id = crypto.randomUUID();
    // keep original ext
    const ext = path.extname(file.originalname || '').slice(0, 12);
    cb(null, `${id}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB (tune)
  fileFilter: (_req, file, cb) => {
    // light filter; keep flexible
    const ok = true;
    cb(null, ok);
  }
});

// --- GET /api/docs  -> { files: [...] }
router.get('/', async (_req, res) => {
  try {
    const db = await readDB();
    // Return newest first
    const files = (db.files || []).sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));
    res.json({ files });
  } catch (e) {
    console.error('GET /api/docs failed', e);
    res.status(500).json({ error: 'Failed to read documents' });
  }
});

// --- POST /api/docs?type=...&year=...   (field name: "file")
router.post('/', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file' });

    const { type = 'other', year = '' } = req.query || {};
    const meta = {
      id: path.basename(file.filename, path.extname(file.filename)), // id used in DELETE
      filename: file.originalname,
      storedAs: file.filename,
      mimetype: file.mimetype,
      length: file.size,
      uploadDate: new Date().toISOString(),
      type: String(type),
      year: year ? Number(year) : undefined,
      path: file.path
    };

    const db = await readDB();
    db.files = db.files || [];
    db.files.push(meta);
    await writeDB(db);

    res.status(201).json({ ok: true, file: meta });
  } catch (e) {
    console.error('POST /api/docs failed', e);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// --- DELETE /api/docs/:id  (removes file + metadata)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const db = await readDB();
    const idx = (db.files || []).findIndex(f => f.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });

    const [rec] = db.files.splice(idx, 1);
    await writeDB(db);

    // best-effort unlink
    if (rec?.storedAs) {
      const full = path.join(UPLOAD_DIR, rec.storedAs);
      fs.unlink(full).catch(() => {});
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/docs failed', e);
    res.status(500).json({ error: 'Delete failed' });
  }
});

module.exports = router;

