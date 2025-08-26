// backend/src/routes/documents.routes.js
const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const multer = require('multer');
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB
const { saveBufferToGridFS, listFiles } = require('../services/documents/storage.service');

const EXPECTED = [
  { key: 'proof_of_id', label: 'Proof of ID (Passport/Driving License)' },
  { key: 'address_proof', label: 'Proof of Address (Utility Bill)' },
  { key: 'bank_statements', label: 'Bank Statements (last 3 months)' },
  { key: 'p60', label: 'P60 (latest)' },
  { key: 'p45', label: 'P45 (if changed jobs)' },
  { key: 'invoices', label: 'Invoices (if self-employed)' },
  { key: 'receipts', label: 'Expense Receipts' },
  { key: 'vat_returns', label: 'VAT Returns (if applicable)' }
];

// POST /api/docs (field: file, optional query: type, year)
router.post('/', auth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const type = (req.query.type || 'other').toString();
  const year = req.query.year ? Number(req.query.year) : undefined;

  const id = await saveBufferToGridFS(req.file.buffer, req.file.originalname, {
    userId: String(req.user.id),
    type, year, uploadedAt: new Date()
  });

  res.json({ ok: true, id });
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

module.exports = router;
