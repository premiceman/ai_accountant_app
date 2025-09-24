// backend/src/routes/vault.routes.js
//
// R2-backed Document Vault with backend-proxied preview/download and rename.
// Collections: <userId>/_collections.json
// Files: <userId>/<collectionId>/<YYYYMMDD>-<uuid>-<safeName>.pdf
//
const express = require('express');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const dayjs = require('dayjs');
const { randomUUID } = require('crypto');
const { s3, BUCKET, putObject, deleteObject, listAll } = require('../utils/r2');
const { GetObjectCommand, PutObjectCommand, CopyObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl: presign } = require('@aws-sdk/s3-request-presigner');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB

// ---- auth ----
function getUser(req) {
  try {
    const hdr = req.headers.authorization || '';
    const [scheme, token] = hdr.split(' ');
    if (scheme !== 'Bearer' || !token) return null;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return { id: decoded.id };
  } catch { return null; }
}

// ---- id/key helpers ----
function b64url(buf) { return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function b64urlDecode(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Buffer.from(s, 'base64').toString('utf8'); }
function keyToFileId(key) { return b64url(key); }
function fileIdToKey(id) { return b64urlDecode(id); }

const userPrefix = (userId) => `${userId}/`;
const collectionsKey = (userId) => `${userId}/_collections.json`;
const collectionPrefix = (userId, colId) => `${userId}/${colId}/`;

// Extract a user-facing filename from an R2 object key tail.
// If the tail matches YYYYMMDD-UUID-name.pdf, return just "name.pdf".
function extractDisplayNameFromKey(key) {
  const tail = String(key).split('/').pop() || 'file.pdf';
  const m = tail.match(/^(\d{8})-([0-9a-fA-F-]{36})-(.+)$/i);
  return m ? m[3] : tail;
}

// ---- collections control doc ----
async function loadCollectionsDoc(userId) {
  try {
    const url = await presign(s3, new GetObjectCommand({ Bucket: BUCKET, Key: collectionsKey(userId) }), { expiresIn: 60 });
    const res = await fetch(url);
    if (!res.ok) throw new Error('not found');
    const json = await res.json();
    const arr = Array.isArray(json?.collections) ? json.collections : Array.isArray(json) ? json : [];
    return arr.map(c => ({ id: String(c.id || c._id || c.collectionId || ''), name: String(c.name || c.title || 'Untitled') })).filter(c => c.id);
  } catch { return []; }
}
async function saveCollectionsDoc(userId, arr) {
  const payload = Buffer.from(JSON.stringify({ collections: arr }, null, 2));
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: collectionsKey(userId), Body: payload, ContentType: 'application/json' }));
}
async function computeCollectionMetrics(userId, cols) {
  const out = [];
  for (const c of cols) {
    const objs = await listAll(collectionPrefix(userId, c.id));
    const files = objs.filter(o => !String(o.Key).endsWith('/'));
    out.push({ id: c.id, name: c.name, fileCount: files.length, bytes: files.reduce((n, o) => n + (o.Size || 0), 0) });
  }
  return out;
}

// ---- stream helper with Range support ----
async function streamR2Object(req, res, key, { inline = true, downloadName = null } = {}) {
  const params = { Bucket: BUCKET, Key: key };
  if (req.headers.range) params.Range = req.headers.range;
  let data;
  try { data = await s3.send(new GetObjectCommand(params)); }
  catch (err) { return res.status(err?.$metadata?.httpStatusCode || 404).json({ error: 'Not found' }); }

  res.set('Accept-Ranges', 'bytes');
  if (data.ContentType) res.set('Content-Type', data.ContentType);
  if (data.ContentLength != null) res.set('Content-Length', String(data.ContentLength));
  if (data.ContentRange) res.set('Content-Range', data.ContentRange);
  const filename = downloadName || (key.split('/').pop() || 'file.pdf');
  res.set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(filename)}"`);
  if (req.headers.range && data.ContentRange) res.status(206);

  const body = data.Body;
  if (typeof body?.pipe === 'function') return void body.pipe(res);
  if (body?.getReader) {
    const reader = body.getReader();
    (async function pump() { const { done, value } = await reader.read(); if (done) return res.end(); res.write(Buffer.from(value)); pump(); })().catch(() => res.end());
  } else res.end();
}

// ---- routes ----
router.get('/stats', async (req, res) => {
  const u = getUser(req); if (!u) return res.status(401).json({ error: 'Unauthorized' });
  const objs = await listAll(userPrefix(u.id));
  const files = objs.filter(o => !String(o.Key).endsWith('/'));
  const totalBytes = files.reduce((n, o) => n + (o.Size || 0), 0);
  res.json({ totalFiles: files.length, totalBytes, totalGB: +(totalBytes / (1024 ** 3)).toFixed(2), lastUpdated: new Date().toISOString() });
});

router.get('/collections', async (req, res) => {
  const u = getUser(req); if (!u) return res.status(401).json({ error: 'Unauthorized' });
  const withMetrics = await computeCollectionMetrics(u.id, await loadCollectionsDoc(u.id));
  res.json({ collections: withMetrics });
});

router.post('/collections', async (req, res) => {
  const u = getUser(req); if (!u) return res.status(401).json({ error: 'Unauthorized' });
  const name = String(req.body?.name || '').trim() || 'Untitled';
  const id = randomUUID();
  const curr = await loadCollectionsDoc(u.id); curr.push({ id, name }); await saveCollectionsDoc(u.id, curr);
  await putObject(collectionPrefix(u.id, id), Buffer.alloc(0), 'application/x-directory').catch(() => {});
  res.json({ collection: { id, name, fileCount: 0, bytes: 0 } });
});

router.get('/collections/:id/files', async (req, res) => {
  const u = getUser(req); if (!u) return res.status(401).json({ error: 'Unauthorized' });
  const colId = String(req.params.id);
  const cols = await loadCollectionsDoc(u.id);
  if (!cols.some(c => c.id === colId)) return res.status(404).json({ error: 'Collection not found' });

  const pref = collectionPrefix(u.id, colId);
  const objs = (await listAll(pref)).filter(o => !String(o.Key).endsWith('/'));

  // >>> Only change needed: derive display name from key without date+uuid prefix
  const items = objs.map(o => {
    const key = String(o.Key);
    const id = keyToFileId(key);
    const displayName = extractDisplayNameFromKey(key);
    return {
      id,
      name: displayName,
      size: o.Size || 0,
      uploadedAt: o.LastModified ? new Date(o.LastModified).toISOString() : null,
      viewUrl: `/api/vault/files/${id}/view`,
      downloadUrl: `/api/vault/files/${id}/download`
    };
  }).sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));
  // <<<

  res.json(items);
});

router.post('/collections/:id/files', upload.array('files'), async (req, res) => {
  const u = getUser(req); if (!u) return res.status(401).json({ error: 'Unauthorized' });
  const colId = String(req.params.id);
  const cols = await loadCollectionsDoc(u.id);
  if (!cols.some(c => c.id === colId)) return res.status(404).json({ error: 'Collection not found' });

  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'No files uploaded' });

  const uploaded = [];
  for (const f of files) {
    const ok = f.mimetype === 'application/pdf' || /\.pdf$/i.test(f.originalname || '');
    if (!ok) return res.status(400).json({ error: 'Only PDF files are allowed' });

    const date = dayjs().format('YYYYMMDD');
    const safeBase = String(f.originalname || 'file.pdf').replace(/[^\w.\- ]+/g, '_');
    const key = `${u.id}/${colId}/${date}-${randomUUID()}-${safeBase}`;
    await putObject(key, f.buffer, 'application/pdf');
    const id = keyToFileId(key);
    uploaded.push({
      id,
      name: safeBase, // returned name has no prefix already
      size: f.size || 0,
      uploadedAt: new Date().toISOString(),
      viewUrl: `/api/vault/files/${id}/view`,
      downloadUrl: `/api/vault/files/${id}/download`
    });
  }
  res.status(201).json({ uploaded });
});

router.delete('/files/:id', async (req, res) => {
  const u = getUser(req); if (!u) return res.status(401).json({ error: 'Unauthorized' });
  const key = fileIdToKey(String(req.params.id || ''));
  if (!key.startsWith(userPrefix(u.id))) return res.status(403).json({ error: 'Forbidden' });
  await deleteObject(key).catch(() => {});
  res.json({ ok: true });
});

router.get('/files/:id/view', async (req, res) => {
  const u = getUser(req); if (!u) return res.status(401).json({ error: 'Unauthorized' });
  const key = fileIdToKey(String(req.params.id || ''));
  if (!key.startsWith(userPrefix(u.id))) return res.status(403).json({ error: 'Forbidden' });
  await streamR2Object(req, res, key, { inline: true });
});

router.get('/files/:id/download', async (req, res) => {
  const u = getUser(req); if (!u) return res.status(401).json({ error: 'Unauthorized' });
  const key = fileIdToKey(String(req.params.id || ''));
  if (!key.startsWith(userPrefix(u.id))) return res.status(403).json({ error: 'Forbidden' });
  await streamR2Object(req, res, key, { inline: false, downloadName: key.split('/').pop() || 'file.pdf' });
});

// Rename (copy→delete; keep date/uuid; swap trailing name)
router.patch('/files/:id', express.json(), async (req, res) => {
  const u = getUser(req); if (!u) return res.status(401).json({ error: 'Unauthorized' });
  const oldKey = fileIdToKey(String(req.params.id || ''));
  if (!oldKey.startsWith(userPrefix(u.id))) return res.status(403).json({ error: 'Forbidden' });

  const newNameRaw = String(req.body?.name || '').trim();
  if (!newNameRaw) return res.status(400).json({ error: 'Missing name' });

  let safeBase = newNameRaw.replace(/[^\w.\- ]+/g, '_');
  if (!/\.pdf$/i.test(safeBase)) safeBase += '.pdf';

  const parts = oldKey.split('/');
  const userId = parts[0], colId = parts[1];
  const tail = parts.slice(2).join('/');
  const m = tail.match(/^(\d{8})-([0-9a-fA-F-]{36})-(.+)$/);
  const date = m ? m[1] : dayjs().format('YYYYMMDD');
  const uuid = m ? m[2] : randomUUID();

  const newKey = `${userId}/${colId}/${date}-${uuid}-${safeBase}`;
  if (newKey === oldKey) {
    const id = keyToFileId(oldKey);
    return res.json({
      id, name: safeBase,
      viewUrl: `/api/vault/files/${id}/view`,
      downloadUrl: `/api/vault/files/${id}/download`
    });
  }

  await s3.send(new CopyObjectCommand({ Bucket: BUCKET, Key: newKey, CopySource: `/${BUCKET}/${encodeURIComponent(oldKey)}` }));
  await deleteObject(oldKey);

  const newId = keyToFileId(newKey);
  res.json({
    id: newId, name: safeBase,
    viewUrl: `/api/vault/files/${newId}/view`,
    downloadUrl: `/api/vault/files/${newId}/download`
  });
});

module.exports = router;
