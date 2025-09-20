// backend/src/routes/vault.routes.js
const express = require('express');
const multer = require('multer');
const { randomUUID } = require('crypto');
const jwt = require('jsonwebtoken');
const dayjs = require('dayjs');
const mongoose = require('mongoose');
const Collection = require('../models/Collection');
const File = require('../models/File');
const { putObject, signedGetUrl, deleteObject } = require('../utils/r2');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

function getUser(req) {
  try {
    const hdr = req.headers.authorization || '';
    const m = hdr.match(/^Bearer\s+(.+)$/i);
    if (!m) return null;
    const token = m[1];
    const secret = process.env.JWT_SECRET || 'dev_secret_change_me';
    return jwt.verify(token, secret);
  } catch { return null; }
}

// Stats
router.get('/stats', async (req, res) => {
  const u = getUser(req);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });
  const totalFiles = await File.countDocuments({ userId: u.id });
  const agg = await File.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(u.id) } },
    { $group: { _id: null, bytes: { $sum: '$size' } } }
  ]);
  const totalBytes = agg?.[0]?.bytes || 0;
  res.json({ totalFiles, totalBytes, totalGB: +(totalBytes / (1024**3)).toFixed(2), lastUpdated: new Date().toISOString() });
});

// Collections
router.get('/collections', async (req, res) => {
  const u = getUser(req);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });
  const cols = await Collection.find({ userId: u.id }).lean();
  const ids = cols.map(c => c._id);
  const metrics = await File.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(u.id), collectionId: { $in: ids } } },
    { $group: { _id: '$collectionId', files: { $sum: 1 }, size: { $sum: '$size' } } }
  ]);
  const map = new Map(metrics.map(m => [String(m._id), m]));
  const out = cols.map(c => ({
    id: String(c._id),
    name: c.name,
    fileCount: map.get(String(c._id))?.files || 0,
    bytes: map.get(String(c._id))?.size || 0
  }));
  res.json({ collections: out });
});

router.post('/collections', async (req, res) => {
  const u = getUser(req);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });
  const name = String(req.body?.name || '').trim() || 'Untitled';
  const c = await Collection.create({ userId: u.id, name });
  res.json({ collection: { id: String(c._id), name: c.name, fileCount: 0, bytes: 0 } });
});

// Files in a collection
router.get('/collections/:id/files', async (req, res) => {
  const u = getUser(req);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });
  const colId = req.params.id;
  const files = await File.find({ userId: u.id, collectionId: colId }).sort({ createdAt: -1 }).lean();
  const items = await Promise.all(files.map(async f => {
    const viewUrl = await signedGetUrl(f.r2Key, 300);
    return {
      id: String(f._id),
      name: f.name,
      size: f.size,
      uploadedAt: f.createdAt,
      viewUrl,
      downloadUrl: viewUrl
    };
  }));
  res.json(items);
});

router.post('/collections/:id/files', upload.array('files'), async (req, res) => {
  const u = getUser(req);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });
  const colId = req.params.id;
  if (!Array.isArray(req.files) || !req.files.length) return res.status(400).json({ error: 'No files' });
  const out = [];
  for (const f of req.files) {
    const key = `${u.id}/${colId}/${dayjs().format('YYYYMMDD')}-${randomUUID()}-${f.originalname}`;
    await putObject(key, f.buffer, f.mimetype || 'application/octet-stream');
    const rec = await File.create({
      userId: u.id,
      collectionId: colId,
      name: f.originalname,
      size: f.size,
      r2Key: key,
      contentType: f.mimetype
    });
    out.push({ id: String(rec._id) });
  }
  res.json({ uploaded: out.length, items: out });
});

router.delete('/files/:id', async (req, res) => {
  const u = getUser(req);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });
  const f = await File.findOne({ _id: req.params.id, userId: u.id });
  if (!f) return res.status(404).json({ error: 'Not found' });
  await deleteObject(f.r2Key).catch(()=>{});
  await f.deleteOne();
  res.json({ ok: true });
});

module.exports = router;
