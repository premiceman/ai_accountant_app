// backend/src/routes/vault.routes.js
//
// R2-only implementation of the Document Vault.
// - No MongoDB needed.
// - Collections are stored in a per-user control file: <userId>/_collections.json
// - Files are stored under: <userId>/<collectionId>/<YYYYMMDD>-<uuid>-<originalName>
// - All endpoints are scoped by the JWT userId.
// Endpoints kept compatible with your frontend/js/document-vault.js.

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
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// --- auth helpers ---
function getUser(req) {
  try {
    const hdr = req.headers.authorization || '';
    const m = hdr.match(/^Bearer\s+(.+)$/i);
    if (!m) return null;
    const token = m[1];
    const secret = process.env.JWT_SECRET || 'dev_secret_change_me';
    return jwt.verify(token, secret); // { id, email, ... }
  } catch { return null; }
}

// --- encoding of file IDs (so front-end can delete by id) ---
function b64url(buf) {
  return Buffer.from(String(buf))
    .toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64').toString('utf8');
}
function keyToFileId(key) { return b64url(key); }
function fileIdToKey(id) { return b64urlDecode(id); }

// --- paths in R2 ---
function userPrefix(userId) { return `${userId}/`; }
function collectionsKey(userId) { return `${userId}/_collections.json`; }
function collectionPrefix(userId, colId) { return `${userId}/${colId}/`; }

// --- load/save collections control doc ---
async function loadCollectionsDoc(userId) {
  const key = collectionsKey(userId);
  try {
    const url = await presign(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 60 });
    const res = await fetch(url);
    if (!res.ok) throw new Error('fetch collections doc failed');
    const json = await res.json();
    // normalize
    const items = Array.isArray(json?.collections) ? json.collections : Array.isArray(json) ? json : [];
    return items.map(c => ({
      id: String(c.id || c._id || c.uuid || c.collectionId || ''),
      name: String(c.name || c.title || 'Untitled')
    })).filter(c => c.id);
  } catch {
    return []; // no doc yet
  }
}

async function saveCollectionsDoc(userId, collections) {
  const key = collectionsKey(userId);
  const body = Buffer.from(JSON.stringify({ collections }, null, 2), 'utf8');
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: body, ContentType: 'application/json'
  }));
}

// --- utility: compute metrics for each collection by listing objects ---
async function computeCollectionMetrics(userId, collections) {
  const out = [];
  for (const c of collections) {
    const pref = collectionPrefix(userId, c.id);
    const all = await listAll(pref);
    const fileObjs = all.filter(o => !String(o.Key).endsWith('/')); // skip any pseudo-folders
    const fileCount = fileObjs.length;
    const bytes = fileObjs.reduce((s, o) => s + (o.Size || 0), 0);
    out.push({ id: c.id, name: c.name, fileCount, bytes });
  }
  return out;
}

// --- GET /api/vault/stats ---
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

// --- GET /api/vault/collections ---
router.get('/collections', async (req, res) => {
  const u = getUser(req);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });

  const cols = await loadCollectionsDoc(u.id);                 // [{id,name}]
  const withMetrics = await computeCollectionMetrics(u.id, cols);
  res.json({ collections: withMetrics });                      // shape matches your front-end
});

// --- POST /api/vault/collections { name } ---
router.post('/collections', async (req, res) => {
  const u = getUser(req);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });

  const name = String(req.body?.name || '').trim() || 'Untitled';
  const id = randomUUID(); // collection id is uuid; used in path
  const curr = await loadCollectionsDoc(u.id);
  curr.push({ id, name });
  await saveCollectionsDoc(u.id, curr);

  // create a zero-byte "folder marker" (optional, harmless)
  await putObject(collectionPrefix(u.id, id), Buffer.alloc(0), 'application/x-directory').catch(()=>{});

  res.json({ collection: { id, name, fileCount: 0, bytes: 0 } });
});

// --- GET /api/vault/collections/:id/files ---
router.get('/collections/:id/files', async (req, res) => {
  const u = getUser(req);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });
  const colId = String(req.params.id);

  // authorize: collection must exist for this user
  const cols = await loadCollectionsDoc(u.id);
  if (!cols.some(c => c.id === colId)) return res.status(404).json({ error: 'Collection not found' });

  const pref = collectionPrefix(u.id, colId);
  const all = await listAll(pref);
  const fileObjs = all.filter(o => !String(o.Key).endsWith('/'));
  const items = await Promise.all(fileObjs.map(async (o) => {
    const name = o.Key.substring(pref.length);
    const fileId = keyToFileId(o.Key);
    const url = await signedGetUrl(o.Key, 300);
    return {
      id: fileId,
      name,
      size: o.Size || 0,
      uploadedAt: o.LastModified ? new Date(o.LastModified).toISOString() : null,
      viewUrl: url,
      downloadUrl: url
    };
  }));
  // newest first
  items.sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));
  res.json(items);
});

// --- POST /api/vault/collections/:id/files  (multipart) ---
router.post('/collections/:id/files', upload.array('files'), async (req, res) => {
  const u = getUser(req);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });
  const colId = String(req.params.id);

  const cols = await loadCollectionsDoc(u.id);
  if (!cols.some(c => c.id === colId)) return res.status(404).json({ error: 'Collection not found' });

  const files = Array.isArray(req.files) ? req.files : [];
  if (!files.length) return res.status(400).json({ error: 'No files' });

  const datePart = dayjs().format('YYYYMMDD');
  const uploaded = [];

  for (const f of files) {
    const safeName = String(f.originalname || 'document').replace(/[\\/:*?"<>|]+/g, '_');
    const key = `${u.id}/${colId}/${datePart}-${randomUUID()}-${safeName}`;
    await putObject(key, f.buffer, f.mimetype || 'application/octet-stream');
    uploaded.push({ id: keyToFileId(key) });
  }

  res.json({ uploaded: uploaded.length, items: uploaded });
});

// --- DELETE /api/vault/files/:id ---
router.delete('/files/:id', async (req, res) => {
  const u = getUser(req);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });
  const fileId = String(req.params.id || '');
  if (!fileId) return res.status(400).json({ error: 'Missing id' });

  const key = fileIdToKey(fileId);

  // authorize: key must start with this user's prefix
  const allowedPrefix = userPrefix(u.id);
  if (!key.startsWith(allowedPrefix)) return res.status(403).json({ error: 'Forbidden' });

  await deleteObject(key).catch(()=>{});
  res.json({ ok: true });
});

module.exports = router;
