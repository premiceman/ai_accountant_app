// backend/src/routes/documents.routes.js
//
// Documents section (separate from Vault) backed by Cloudflare R2.
//
// Directory layout per user:
//   <userId>/accounting files/<YYYYMMDD>-<uuid>-<originalName>
//
// Endpoints kept compatible with your frontend:
//   GET    /api/documents
//   POST   /api/documents                (multipart: 'files'[] or single 'file')
//   GET    /api/documents/:id/view       (inline, Range supported)
//   GET    /api/documents/:id/download   (attachment, Range supported)
//   DELETE /api/documents/:id
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

// ---------- id/key helpers ----------
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

function docsPrefix(userId) {
  // Folder name includes a space, as requested
  return `${userId}/accounting files/`;
}
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
    (async function pump() { const { done, value } = await reader.read(); if (done) return res.end(); res.write(Buffer.from(value)); pump(); })().catch(() => res.end());
  } else res.end();
}

// ---------- routes ----------

// List user's documents
router.get('/', async (req, res) => {
  const u = getUser(req); if (!u) return res.status(401).json({ error: 'Unauthorized' });

  // We intentionally ignore potential query filters here (legacy UI filters client-side).
  const objs = (await listAll(docsPrefix(u.id))).filter(o => !String(o.Key).endsWith('/'));

  const items = objs.map(o => {
    const key = String(o.Key);
    const id = keyToFileId(key);
    const name = extractDisplayNameFromKey(key);
    const uploadedAt = o.LastModified ? new Date(o.LastModified).toISOString() : null;
    const size = o.Size || 0;

    // Return both legacy and new fields to satisfy all clients
    return {
      // new-ish fields your normalizer handles
      id,
      name,
      size,
      uploadedAt,
      viewUrl: `/api/documents/${id}/view`,
      downloadUrl: `/api/documents/${id}/download`,

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

  // These query params are sent by your UI; we echo them back for compatibility
  const docType = String(req.query.type || '').trim();
  const year    = String(req.query.year || '').trim();

  // Normalize files array
  let files = req.files || [];
  if (!files.length && req.file) files = [req.file];
  if (!files.length) return res.status(400).json({ error: 'No files uploaded' });

  // Accept PDFs and common images (useful for proof of ID)
  const okMime = (m, name) =>
    /^application\/pdf$/i.test(m || '') ||
    /^image\/(png|jpe?g)$/i.test(m || '') ||
    /\.pdf$/i.test(name || '') ||
    /\.(png|jpe?g)$/i.test(name || '');

  const uploaded = [];
  const legacyFiles = []; // for legacy response alias 'files'

  for (const f of files) {
    if (!okMime(f.mimetype, f.originalname)) {
      return res.status(400).json({ error: 'Unsupported file type' });
    }

    const date = dayjs().format('YYYYMMDD');
    const safeBase = String(f.originalname || 'document').replace(/[^\w.\- ]+/g, '_');
    const key = `${u.id}/accounting files/${date}-${randomUUID()}-${safeBase}`;
    await putObject(key, f.buffer, f.mimetype || 'application/octet-stream');

    const id = keyToFileId(key);
    const uploadedAt = new Date().toISOString();
    const size = f.size || 0;

    const common = {
      id,
      // new-ish shape
      name: safeBase,
      size,
      uploadedAt,
      viewUrl: `/api/documents/${id}/view`,
      downloadUrl: `/api/documents/${id}/download`,
      // include the params you sent so the UI can categorize immediately if it uses them
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

  // IMPORTANT: reply with the legacy "files" array (and keep "uploaded" too)
  return res.status(201).json({ files: legacyFiles, uploaded });
});

// Delete one document
router.delete('/:id', async (req, res) => {
  const u = getUser(req); if (!u) return res.status(401).json({ error: 'Unauthorized' });

  const key = fileIdToKey(String(req.params.id || ''));
  if (!key.startsWith(docsPrefix(u.id))) return res.status(403).json({ error: 'Forbidden' });

  await deleteObject(key).catch(() => {});
  res.json({ ok: true });
});

// Inline preview
router.get('/:id/view', async (req, res) => {
  const u = getUser(req); if (!u) return res.status(401).json({ error: 'Unauthorized' });
  const key = fileIdToKey(String(req.params.id || ''));
  if (!key.startsWith(docsPrefix(u.id))) return res.status(403).json({ error: 'Forbidden' });
  await streamR2Object(req, res, key, { inline: true });
});

// Download
router.get('/:id/download', async (req, res) => {
  const u = getUser(req); if (!u) return res.status(401).json({ error: 'Unauthorized' });
  const key = fileIdToKey(String(req.params.id || ''));
  if (!key.startsWith(docsPrefix(u.id))) return res.status(403).json({ error: 'Forbidden' });
  const name = key.split('/').pop() || 'document';
  await streamR2Object(req, res, key, { inline: false, downloadName: name });
});

module.exports = router;
