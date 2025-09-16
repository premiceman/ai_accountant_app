// backend/routes/vault.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const auth = require('../middleware/auth');
const VaultCollection = require('../models/VaultCollection');
const VaultFile = require('../models/VaultFile');

let multer;
try { multer = require('multer'); } catch { /* remind to install */ }

const UPLOAD_ROOT = path.join(__dirname, '../../uploads');
const VAULT_ROOT  = path.join(UPLOAD_ROOT, 'vault');

// Ensure base dirs exist
fs.mkdirSync(VAULT_ROOT, { recursive: true });

// ---------- helpers ----------
function ensureMulter() {
  if (!multer) {
    const err = new Error('Missing dependency: multer. Run `npm i multer` on the server.');
    err.status = 500;
    throw err;
  }
}

function pdfOnly(_req, file, cb) {
  const ok = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname || '');
  cb(ok ? null : new Error('Only PDF files are allowed'), ok);
}

function storageFor(userId, collectionId) {
  return multer.diskStorage({
    destination: function(_req, _file, cb) {
      const dest = path.join(VAULT_ROOT, String(userId), String(collectionId));
      fs.mkdirSync(dest, { recursive: true });
      cb(null, dest);
    },
    filename: function(_req, file, cb) {
      const ts = Date.now();
      const safeBase = String(file.originalname || 'file.pdf').replace(/[^\w.\- ]+/g, '_');
      const ext = path.extname(safeBase) || '.pdf';
      const base = path.basename(safeBase, ext).slice(0, 60).replace(/\s+/g, '_');
      cb(null, `${base}__${ts}${ext.toLowerCase() || '.pdf'}`);
    }
  });
}

function bytesToGB(n) { return Number(n || 0) / (1024 ** 3); }

// ---------- routes ----------

// Seed defaults (idempotent helper)
async function ensureDefaultCollections(userId, names=[]) {
  if (!names.length) return [];
  const existing = await VaultCollection.find({ userId }).lean();
  const have = new Set(existing.map(x => x.name.toLowerCase()));
  const toCreate = names.filter(n => !have.has(n.toLowerCase())).map(name => ({ userId, name }));
  if (!toCreate.length) return existing;
  await VaultCollection.insertMany(toCreate);
  return await VaultCollection.find({ userId }).lean();
}

// GET /api/vault/stats
router.get('/stats', auth, async (req, res) => {
  const agg = await VaultFile.aggregate([
    { $match: { userId: req.user.id } },
    { $group: { _id: null, totalFiles: { $sum: 1 }, totalBytes: { $sum: '$size' }, lastUpdated: { $max: '$uploadedAt' } } }
  ]);
  const s = agg[0] || { totalFiles: 0, totalBytes: 0, lastUpdated: null };
  res.json({
    totalFiles: s.totalFiles,
    totalBytes: s.totalBytes,
    totalGB: Math.round(bytesToGB(s.totalBytes) * 100) / 100,
    lastUpdated: s.lastUpdated
  });
});

// GET /api/vault/collections
router.get('/collections', auth, async (req, res) => {
  // Ensure defaults if empty
  const defaults = ['Mortgage Documents', 'Nationality Documents', 'Banking', 'Will and Testament', 'Policies'];
  let cols = await VaultCollection.find({ userId: req.user.id }).sort({ createdAt: 1 }).lean();
  if (cols.length === 0) {
    cols = await ensureDefaultCollections(req.user.id, defaults);
  }

  // Attach counts & sizes
  const sizes = await VaultFile.aggregate([
    { $match: { userId: req.user.id } },
    { $group: { _id: '$collectionId', count: { $sum: 1 }, bytes: { $sum: '$size' }, latest: { $max: '$uploadedAt' } } }
  ]);
  const byId = new Map(sizes.map(s => [String(s._id), s]));
  const out = cols.map(c => {
    const s = byId.get(String(c._id)) || { count: 0, bytes: 0, latest: null };
    return {
      id: c._id, name: c.name, description: c.description || '',
      createdAt: c.createdAt, updatedAt: c.updatedAt,
      fileCount: s.count, bytes: s.bytes, latest: s.latest
    };
  });
  res.json({ collections: out });
});

// POST /api/vault/collections (create one)
router.post('/collections', auth, async (req, res) => {
  const name = String((req.body?.name || '')).trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const doc = await VaultCollection.create({ userId: req.user.id, name });
    res.status(201).json({ collection: { id: doc._id, name: doc.name, description: doc.description || '', createdAt: doc.createdAt, updatedAt: doc.updatedAt, fileCount: 0, bytes: 0 } });
  } catch (e) {
    if (e.code === 11000) return res.status(400).json({ error: 'A collection with this name already exists' });
    console.error('Create collection error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/vault/collections/bulk-create
router.post('/collections/bulk-create', auth, async (req, res) => {
  const names = Array.isArray(req.body?.names) ? req.body.names.map(x => String(x).trim()).filter(Boolean) : [];
  if (!names.length) return res.status(400).json({ error: 'names[] required' });
  const cols = await ensureDefaultCollections(req.user.id, names);
  res.json({ collections: cols.map(c => ({ id: c._id, name: c.name, createdAt: c.createdAt, updatedAt: c.updatedAt })) });
});

// GET /api/vault/collections/:id/files
router.get('/collections/:id/files', auth, async (req, res) => {
  const col = await VaultCollection.findOne({ _id: req.params.id, userId: req.user.id });
  if (!col) return res.status(404).json({ error: 'Collection not found' });

  const files = await VaultFile.find({ userId: req.user.id, collectionId: col._id }).sort({ uploadedAt: -1 }).lean();
  res.json({
    collection: { id: col._id, name: col.name },
    files: files.map(f => ({
      id: f._id,
      name: f.originalName,
      size: f.size,
      mime: f.mime,
      uploadedAt: f.uploadedAt,
      viewUrl: `/api/vault/files/${f._id}/view`,
      downloadUrl: `/api/vault/files/${f._id}/download`
    }))
  });
});

// POST /api/vault/collections/:id/files (PDF upload)
router.post('/collections/:id/files', auth, async (req, res) => {
  ensureMulter();

  // Verify collection belongs to user
  const col = await VaultCollection.findOne({ _id: req.params.id, userId: req.user.id });
  if (!col) return res.status(404).json({ error: 'Collection not found' });

  const upload = multer({
    storage: storageFor(req.user.id, col._id),
    fileFilter: pdfOnly,
    limits: { fileSize: 50 * 1024 * 1024 } // 50 MB
  }).array('files', 20);

  upload(req, res, async (err) => {
    if (err) {
      const msg = err.message || 'Upload failed';
      return res.status(400).json({ error: msg });
    }
    const files = (req.files || []);
    if (!files.length) return res.status(400).json({ error: 'No files uploaded' });

    const docs = [];
    for (const f of files) {
      const rel = path.join('vault', String(req.user.id), String(col._id), f.filename).replace(/\\/g, '/');
      docs.push(await VaultFile.create({
        userId: req.user.id,
        collectionId: col._id,
        originalName: f.originalname || f.filename,
        storedName: f.filename,
        size: f.size || 0,
        mime: f.mimetype || 'application/pdf',
        ext: path.extname(f.filename).slice(1).toLowerCase() || 'pdf',
        pathRel: rel
      }));
    }
    res.status(201).json({ uploaded: docs.map(d => ({ id: d._id, name: d.originalName, size: d.size, uploadedAt: d.uploadedAt })) });
  });
});

// DELETE /api/vault/files/:id
router.delete('/files/:id', auth, async (req, res) => {
  const file = await VaultFile.findOne({ _id: req.params.id, userId: req.user.id });
  if (!file) return res.status(404).json({ error: 'File not found' });

  try {
    const abs = path.join(UPLOAD_ROOT, file.pathRel);
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch (e) {
    console.warn('File unlink warning:', e?.message);
  }
  await VaultFile.deleteOne({ _id: file._id, userId: req.user.id });
  res.json({ ok: true });
});

// GET /api/vault/files/:id/view (authorized inline view)
router.get('/files/:id/view', auth, async (req, res) => {
  const file = await VaultFile.findOne({ _id: req.params.id, userId: req.user.id });
  if (!file) return res.status(404).json({ error: 'File not found' });
  const abs = path.join(UPLOAD_ROOT, file.pathRel);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'File missing on disk' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.originalName || 'document.pdf')}"`);
  fs.createReadStream(abs).pipe(res);
});

// GET /api/vault/files/:id/download (authorized attachment)
router.get('/files/:id/download', auth, async (req, res) => {
  const file = await VaultFile.findOne({ _id: req.params.id, userId: req.user.id });
  if (!file) return res.status(404).json({ error: 'File not found' });
  const abs = path.join(UPLOAD_ROOT, file.pathRel);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'File missing on disk' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.originalName || 'document.pdf')}"`);
  fs.createReadStream(abs).pipe(res);
});

module.exports = router;
