// backend/src/routes/vault.routes.js
//
// R2-only implementation of the Document Vault.
// - Collections: <userId>/_collections.json
// - Files:       <userId>/<collectionId>/<YYYYMMDD>-<uuid>-<originalName>
// - JWT userId is used as the per-user namespace.
// - Endpoints match frontend/js/document-vault.js expectations.
//
const express = require('express');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const dayjs = require('dayjs');
const { randomUUID } = require('crypto');
const {
  putObject,
  deleteObject,
  signedGetUrl,
  listAll,
  s3,
  BUCKET
} = require('../utils/r2');
const { GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl: presign } = require('@aws-sdk/s3-request-presigner');

const router = express.Router();
// ↑ 50 MB (parity with legacy route)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// -------- auth helpers --------
function getUser(req) {
  try {
    const hdr = req.headers.authorization || '';
    const parts = hdr.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') return null;
    const token = parts[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return { id: decoded.id };
  } catch { return null; }
}

// -------- id/paths helpers --------
function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64').toString('utf8');
}
function keyToFileId(key) { return b64url(key); }
function fileIdToKey(id) { return b64urlDecode(id); }

function userPrefix(userId) { return `${userId}/`; }
function collectionsKey(userId) { return `${userId}/_collections.json`; }
function collectionPrefix(userId, colId) { return `${userId}/${colId}/`; }

// -------- collections control doc in R2 --------
async function loadCollectionsDoc(userId) {
  const key = collectionsKey(userId);
  try {
    const url = await presign(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 60 });
    const res = await fetch(url);
    if (!res.ok) throw new Error('fetch collections doc failed');
    const json = await res.json();
    const items = Array.isArray(json?.collections) ? json.collections : Array.isArray(json) ? json : [];
    return items.map(c => ({
      id: String(c.id || c._id || c.uuid || c.collectionId || ''),
      name: String(c.name || c.title || 'Untitled')
    })).filter(c => c.id);
  } catch {
    return []; // not found yet
  }
}

async function saveCollectionsDoc(userId, arr) {
  const payload = Buffer.from(JSON.stringify({ collections: arr }, null, 2));
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: collectionsKey(userId),
    Body: payload,
    ContentType: 'application/json'
  }));
}

async function computeCollectionMetrics(userId, cols) {
  const out = [];
  for (const c of cols) {
    const pref = collectionPrefix(userId, c.id);
    const all = await listAll(pref);
    const files = all.filter(o => !String(o.Key).endsWith('/'));
    const fileCount = files.length;
    const bytes = files.reduce((s, o) => s + (o.Size || 0), 0);
    out.push({ id: c.id, name: c.name, fileCount, bytes });
  }
  return out;
}

// -------- routes --------

// GET /api/vault/stats
router.get('/stats', async (req, res) => {
  const u = getUser(req);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });

  const all = await listAll(userPrefix(u.id));
  const files = all.filter(o => !String(o.Key).endsWith('/'));
  const totalFiles = files.length;
  const totalBytes = files.reduce((s, o) => s + (o.Size || 0), 0);
  res.json({
    totalFiles,
    totalBytes,
    totalGB: +(totalBytes / (1024 ** 3)).toFixed(2),
    lastUpdated: new Date().toISOString()
  });
});

// GET /api/vault/collections
router.get('/collections', async (req, res) => {
  const u = getUser(req);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });
  const cols = await loadCollectionsDoc(u.id);
  const withMetrics = await computeCollectionMetrics(u.id, cols);
  res.json({ collections: withMetrics });
});

// POST /api/vault/collections
router.post('/collections', async (req, res) => {
  const u = getUser(req);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });

  const name = String(req.body?.name || '').trim() || 'Untitled';
  const id = randomUUID();
  const curr = await loadCollectionsDoc(u.id);
  curr.push({ id, name });
  await saveCollectionsDoc(u.id, curr);
  // marker (optional)
  await putObject(collectionPrefix(u.id, id), Buffer.alloc(0), 'application/x-directory').catch(()=>{});
  res.json({ collection: { id, name, fileCount: 0, bytes: 0 } });
});

// GET /api/vault/collections/:id/files
router.get('/collections/:id/files', async (req, res) => {
  const u = getUser(req);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });
  const colId = String(req.params.id);

  const cols = await loadCollectionsDoc(u.id);
  if (!cols.some(c => c.id === colId)) return res.status(404).json({ error: 'Collection not found' });

  const pref = collectionPrefix(u.id, colId);
  const all = await listAll(pref);
  const fileObjs = all.filter(o => !String(o.Key).endsWith('/'));

  const items = await Promise.all(fileObjs.map(async (o) => {
    const key = String(o.Key);
    const fileId = keyToFileId(key);
    const name = key.split('/').pop() || 'file.pdf';
    const url = await signedGetUrl(key, 300); // 5 minutes
    return {
      id: fileId,
      name,
      size: o.Size || 0,
      uploadedAt: o.LastModified ? new Date(o.LastModified).toISOString() : null,
      viewUrl: url,
      downloadUrl: url
    };
  }));
  items.sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));
  res.json(items);
});

// POST /api/vault/collections/:id/files
router.post('/collections/:id/files', upload.array('files'), async (req, res) => {
  const u = getUser(req);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });
  const colId = String(req.params.id);

  const cols = await loadCollectionsDoc(u.id);
  if (!cols.some(c => c.id === colId)) return res.status(404).json({ error: 'Collection not found' });

  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'No files uploaded' });

  const uploaded = [];
  for (const f of files) {
    // Accept PDF only (front-end enforces too)
    const okMime = f.mimetype === 'application/pdf' || /\.pdf$/i.test(f.originalname || '');
    if (!okMime) return res.status(400).json({ error: 'Only PDF files are allowed' });

    const date = dayjs().format('YYYYMMDD');
    const safeBase = String(f.originalname || 'file.pdf').replace(/[^\w.\- ]+/g, '_');
    const key = `${u.id}/${colId}/${date}-${randomUUID()}-${safeBase}`;
    await putObject(key, f.buffer, 'application/pdf');
    uploaded.push({ id: keyToFileId(key), name: safeBase, size: f.size || 0, uploadedAt: new Date().toISOString() });
  }
  res.status(201).json({ uploaded });
});

// DELETE /api/vault/files/:id
router.delete('/files/:id', async (req, res) => {
  const u = getUser(req);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });
  const fileId = String(req.params.id || '');
  if (!fileId) return res.status(400).json({ error: 'Missing id' });

  const key = fileIdToKey(fileId);
  const allowedPrefix = userPrefix(u.id);
  if (!key.startsWith(allowedPrefix)) return res.status(403).json({ error: 'Forbidden' });

  await deleteObject(key).catch(()=>{});
  res.json({ ok: true });
});

module.exports = router;
