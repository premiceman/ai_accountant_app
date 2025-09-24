// backend/src/routes/documents.routes.js
//
// Documents section (separate from Vault) backed by Cloudflare R2.
// Fix: make IDs URL-safe (base64url) and encode in URLs so preview/download/delete work.
//
// Layout per user:
//   <userId>/accounting files/<YYYYMMDD>-<uuid>-<originalName>
//
const express = require('express');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const dayjs = require('dayjs');
const { randomUUID } = require('crypto');

const { s3, BUCKET, putObject, deleteObject, listAll } = require('../utils/r2');
const { GetObjectCommand } = require('@aws-sdk/client-s3');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB

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

// ---------- id/key helpers (URL-SAFE) ----------
function b64urlEncode(str) {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}
function b64urlDecode(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  // restore padding
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64').toString('utf8');
}
function keyToFileId(key) { return b64urlEncode(String(key)); }
function fileIdToKey(id) { return b64urlDecode(String(id)); }

function docsPrefix(userId) { return `${userId}/accounting files/`; }
function extractDisplayNameFromKey(key) {
  const tail = String(key).split('/').pop() || 'document';
  const m = tail.match(/^(\d{8})-([0-9a-fA-F-]{36})-(.+)$/i);
  return m ? m[3] : tail;
}

// ---------- proxy stream helper (Range support) ----------
async function streamR2Object(req, res, key, { inline = true, downloadName = null } = {}) {
  const params = { Bucket: BUCKET, Key: key };
  const range = req.headers.range;
  if (range) params.Range = range;

  let data;
  try { data = await s3.send(new GetObjectCommand(params)); }
  catch (err) {
    const code = err?.$metadata?.httpStatusCode || 404;
    return res.status(code).json({ error: 'Not found' });
  }

  res.set('Accept-Ranges', 'bytes');
  if (data.ContentType) res.set('Content-Type', data.ContentType);
  if (data.ContentLength != null) res.set('Content-Length', String(data.ContentLength));
  if (data.ContentRange) res.set('Content-Range', data.ContentRange);
  const filename = downloadName || (key.split('/').pop() || 'document');
  res.set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(filename)}"`);
  if (range && data.ContentRange) res.status(206);

  const body = data.Body;
  if (typeof body?.pipe === 'function') return void body.pipe(res);
  if (body?.getReader) {
    const reader = body.getReader();
    (async function pump() {
      const { done, value } = await reader.read();
      if (done) return res.end();
      res.write(Buffer.from(value));
      pump();
    })().catch(() => res.end());
  } else res.end();
}

// ---------- routes ----------

// List user's documents
router.get('/', async (req, res) => {
  const u = getUser(req); if (!u) return res.status(401).json({ error: 'Unauthorized' });

  const objs = (await listAll(docsPrefix(u.id))).filter(o => !String(o.Key).endsWith('/'));

  const items = objs.map(o => {
    const key = String(o.Key);
    const id = keyToFileId(key);                // URL-safe id
    const encId = encodeURIComponent(id);       // encode when embedding in URL
    const name = extractDisplayNameFromKey(key);
    const uploadedAt = o.LastModified ? new Date(o.LastModified).toISOString() : null;
    const size = o.Size || 0;

    return {
      // new-ish fields your normalizer handles
      id,
      name,
      size,
      uploadedAt,
      viewUrl: `/api/documents/${encId}/view`,
      downloadUrl: `/api/documents/${encId}/download`,

      // legacy fields (for older Documents UI)
      filename: name,
      length: size,
      uploadDate: uploadedAt ? new Date(uploadedAt) : null,
      contentType: 'application/octet-stream'
    };
  }).sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));

  res.json(items);
});

// Upload (supports 'files'[], or single 'file')
router.post('/', upload.any(), async (req, res) => {
  const u = getUser(req); if (!u) return res.status(401).json({ error: 'Unauthorized' });

  const docType = String(req.query.type || '').trim();
  const year    = String(req.query.year || '').trim();

  let files = req.files || [];
  if (!files.length && req.file) files = [req.file];
  if (!files.length) return res.status(400).json({ error: 'No files uploaded' });

  const okMime = (m, name) =>
    /^application\/pdf$/i.test(m || '') ||
    /^image\/(png|jpe?g)$/i.test(m || '') ||
    /\.pdf$/i.test(name || '') ||
    /\.(png|jpe?g)$/i.test(name || '');

  const uploaded = [];
  const legacyFiles = [];

  for (const f of files) {
    if (!okMime(f.mimetype, f.originalname)) {
      return res.status(400).json({ error: 'Unsupported file type' });
    }

    const date = dayjs().format('YYYYMMDD');
    const safeBase = String(f.originalname || 'document').replace(/[^\w.\- ]+/g, '_');
    const key = `${u.id}/accounting files/${date}-${randomUUID()}-${safeBase}`;
    await putObject(key, f.buffer, f.mimetype || 'application/octet-stream');

    const id = keyToFileId(key);              // URL-safe id
    const encId = encodeURIComponent(id);
    const uploadedAt = new Date().toISOString();
    const size = f.size || 0;

    const common = {
      id,
      name: safeBase,
      size,
      uploadedAt,
      viewUrl: `/api/documents/${encId}/view`,
      downloadUrl: `/api/documents/${encId}/download`,
      type: docType || undefined,
      year: year || undefined
    };

    const legacy = {
      id,
      filename: safeBase,
      length: size,
      uploadDate: new Date(uploadedAt),
      contentType: f.mimetype || 'application/octet-stream',
      viewUrl: common.viewUrl,
      downloadUrl: common.downloadUrl,
      type: common.type,
      year: common.year
    };

    uploaded.push(common);
    legacyFiles.push(legacy);
  }

  return res.status(201).json({ files: legacyFiles, uploaded });
});

// Delete one document
router.delete('/:id', async (req, res) => {
  const u = getUser(req); if (!u) return res.status(401).json({ error: 'Unauthorized' });

  // id is base64url in path → decode to key
  const key = fileIdToKey(decodeURIComponent(String(req.params.id || '')));
  if (!key.startsWith(docsPrefix(u.id))) return res.status(403).json({ error: 'Forbidden' });

  await deleteObject(key).catch(() => {});
  res.json({ ok: true });
});

// Inline preview
router.get('/:id/view', async (req, res) => {
  const u = getUser(req); if (!u) return res.status(401).json({ error: 'Unauthorized' });
  const key = fileIdToKey(decodeURIComponent(String(req.params.id || '')));
  if (!key.startsWith(docsPrefix(u.id))) return res.status(403).json({ error: 'Forbidden' });
  await streamR2Object(req, res, key, { inline: true });
});

// Download
router.get('/:id/download', async (req, res) => {
  const u = getUser(req); if (!u) return res.status(401).json({ error: 'Unauthorized' });
  const key = fileIdToKey(decodeURIComponent(String(req.params.id || '')));
  if (!key.startsWith(docsPrefix(u.id))) return res.status(403).json({ error: 'Forbidden' });
  const name = key.split('/').pop() || 'document';
  await streamR2Object(req, res, key, { inline: false, downloadName: name });
});

module.exports = router;
