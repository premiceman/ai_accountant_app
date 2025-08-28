// backend/src/routes/documents.routes.js
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
  storage: multer.memoryStorage(),                   // so req.file.buffer is available
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 }  // configurable limit
});

const EXPECTED = [
  { key: 'proof_of_id', label: 'Proof of ID (Passport/Driving Licence)' },
  { key: 'address_proof', label: 'Proof of Address (Utility Bill)' },
  { key: 'bank_statements', label: 'Bank Statements (last 3 months)' },
  { key: 'p60', label: 'P60 (latest)' },
  { key: 'p45', label: 'P45 (if changed jobs)' },
  { key: 'invoices', label: 'Invoices (if self-employed)' },
  { key: 'receipts', label: 'Expense Receipts' },
  { key: 'vat_returns', label: 'VAT Returns (if applicable)' }
];

// POST /api/docs (field: file, ?type, ?year)
// We wrap upload.single to catch Multer errors and return a friendly 413.
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
        type,
        year,
        uploadedAt: new Date()
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

// GET /api/docs/expected
router.get('/expected', auth, async (req, res) => {
  const files = await listFiles(req.user.id);
  const have = new Set(files.map(f => f.metadata?.type).filter(Boolean));
  const required = EXPECTED.map(x => ({ ...x, status: have.has(x.key) ? 'uploaded' : 'missing' }));
  res.json({ required });
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

module.exports = router;
