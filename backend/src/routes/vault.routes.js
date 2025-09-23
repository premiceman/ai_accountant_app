// backend/src/routes/vault.routes.js
//
// R2-backed Document Vault with backend-proxied preview/download and rename.
// - Collections: <userId>/_collections.json
// - Files:       <userId>/<collectionId>/<YYYYMMDD>-<uuid>-<safeName>.pdf
//
const express = require('express');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const dayjs = require('dayjs');
const { randomUUID } = require('crypto');

const {
  putObject,
  deleteObject,
  listAll,
  s3,
  BUCKET
} = require('../utils/r2');

const {
  GetObjectCommand,
  PutObjectCommand,
  CopyObjectCommand
} = require('@aws-sdk/client-s3');

const { getSignedUrl: presign } = require('@aws-sdk/s3-request-presigner');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB parity
});

// ---------- auth ----------
function getUser(req) {
  try {
    const hdr = req.headers.authorization || '';
    const [scheme, token] = hdr.split(' ');
    if (scheme !== 'Bearer' || !token) return null;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return { id: decoded.id };
  } catch { return null; }
}

// ---------- id/key helpers ----------
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
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

// ---------- collections control doc in R2 ----------
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
    return [];
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

// ---------- streaming helper with Range support ----------
async function streamR2Object(req, res, key, { inline = true, downloadName = null } = {}) {
  const rangeHeader = req.headers.range; // support partial content for PDFs
  const cmdParams = { Bucket: BUCKET, Key: key };
  if (rangeHeader) cmdParams.Range = rangeHeader;

  let data;
  try {
    data = await s3.send(new GetObjectCommand(cmdParams));
  } catch (err) {
    const code = err?.$metadata?.httpStatusCode || 404;
    return res.status(code).json({ error: 'Not found' });
  }

  // Basic headers
  res.set('Accept-Ranges', 'bytes');
  if (data.ContentType) res.set('Content-Type', data.ContentType);
  if (data.ContentLength != null) res.set('Content-Length', String(data.ContentLength));
  if (data.ContentRange) res.set('Content-Range', data.ContentRange);

  const filename = downloadName || (key.split('/').pop() || 'file.pdf');

  // Content-Disposition
  const disp = inline ? 'inline' : 'attachment';
  res.set('Content-Disposition', `${disp}; filename="${encodeURIComponent(filename)}"`);

  // Status code for ranged responses
  if (rangeHeader && data.ContentRange) res.status(206);

  // Stream body
  const body = data.Body;
  if (typeof body?.pipe === 'function') {
    body.pipe(res);
  } else if (body) {
    // web stream
    const reader = body.getReader();
    async function pump() {
      const { done, value } = await reader.read();
      if (done) return res.end();
      res.write(Buffer.from(value));
      return pump();
    }
    pump().catch(() => res.end());
  } else {
    res.end();
  }
}

// ---------- routes ----------

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
  // optional folder marker
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

  const items = fileObjs.map((o) => {
    const key = String(o.Key);
    const fileId = keyToFileId(key);
    const name = key.split('/').pop() || 'file.pdf';
    // IMPORTANT: use backend-proxied endpoints, not direct R2 URLs
    const viewPath = `/api/vault/files/${fileId}/view`;
    const downloadPath = `/api/vault/files/${fileId}/download`;
    return {
      id: fileId,
      name,
      size: o.Size || 0,
      uploadedAt: o.LastModified ? new Date(o.LastModified).toISOString() : null,
      viewUrl: viewPath,
      downloadUrl: downloadPath
    };
  });
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
    const okMime = f.mimetype === 'application/pdf' || /\.pdf$/i.test(f.originalname || '');
    if (!okMime) return res.status(400).json({ error: 'Only PDF files are allowed' });

    const date = dayjs().format('YYYYMMDD');
    const safeBase = String(f.originalname || 'file.pdf').replace(/[^\w.\- ]+/g, '_');
    const key = `${u.id}/${colId}/${date}-${randomUUID()}-${safeBase}`;
    await putObject(key, f.buffer, 'application/pdf');

    const id = keyToFileId(key);
    uploaded.push({
      id,
      name: safeBase,
      size: f.size || 0,
      uploadedAt: new Date().toISOString(),
      viewUrl: `/api/vault/files/${id}/view`,
      downloadUrl: `/api/vault/files/${id}/download`
    });
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

// GET /api/vault/files/:id/view  (inline preview)
router.get('/files/:id/view', async (req, res) => {
  const u = getUser(req);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });
  const key = fileIdToKey(String(req.params.id || ''));
  if (!key.startsWith(userPrefix(u.id))) return res.status(403).json({ error: 'Forbidden' });
  await streamR2Object(req, res, key, { inline: true });
});

// GET /api/vault/files/:id/download  (attachment)
router.get('/files/:id/download', async (req, res) => {
  const u = getUser(req);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });
  const key = fileIdToKey(String(req.params.id || ''));
  if (!key.startsWith(userPrefix(u.id))) return res.status(403).json({ error: 'Forbidden' });
  const name = key.split('/').pop() || 'file.pdf';
  await streamR2Object(req, res, key, { inline: false, downloadName: name });
});

// PATCH /api/vault/files/:id  (rename)
router.patch('/files/:id', express.json(), async (req, res) => {
  const u = getUser(req);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });

  const fileId = String(req.params.id || '');
  const newNameRaw = String(req.body?.name || '').trim();
  if (!fileId || !newNameRaw) return res.status(400).json({ error: 'Missing id or name' });

  const oldKey = fileIdToKey(fileId);
  const allowedPrefix = userPrefix(u.id);
  if (!oldKey.startsWith(allowedPrefix)) return res.status(403).json({ error: 'Forbidden' });

  // sanitize new filename, enforce .pdf
  let safeBase = newNameRaw.replace(/[^\w.\- ]+/g, '_');
  if (!/\.pdf$/i.test(safeBase)) safeBase += '.pdf';

  // preserve colId + date + uuid; only swap trailing name
  const parts = oldKey.split('/');
  const userId = parts[0];
  const colId = parts[1];
  const oldFile = parts.slice(2).join('/'); // YYYYMMDD-UUID-oldname.pdf
  const m = oldFile.match(/^(\d{8})-([0-9a-fA-F-]{36})-(.+)$/);
  const date = m ? m[1] : dayjs().format('YYYYMMDD');
  const uuid = m ? m[2] : randomUUID();

  const newKey = `${userId}/${colId}/${date}-${uuid}-${safeBase}`;

  if (newKey === oldKey) return res.json({
    id: fileId,
    name: safeBase,
    viewUrl: `/api/vault/files/${fileId}/view`,
    downloadUrl: `/api/vault/files/${fileId}/download`
  });

  // Copy then delete
  const copySource = `/${BUCKET}/${encodeURIComponent(oldKey)}`;
  await s3.send(new CopyObjectCommand({
    Bucket: BUCKET,
    Key: newKey,
    CopySource: copySource
  }));
  await deleteObject(oldKey);

  const newId = keyToFileId(newKey);
  res.json({
    id: newId,
    name: safeBase,
    viewUrl: `/api/vault/files/${newId}/view`,
    downloadUrl: `/api/vault/files/${newId}/download`
  });
});

module.exports = router;
