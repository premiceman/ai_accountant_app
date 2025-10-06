// backend/src/routes/vault.routes.js
//
// R2-backed Document Vault with:
// - backend-proxied preview/download (+ Range)
// - rename (copy→delete)
// - list shows clean filename (strip YYYYMMDD-UUID- prefix)
// - NEW: delete collection (and all files)
// - NEW: download collection as ZIP
//
// Collections: <userId>/_collections.json
// Files:       <userId>/<collectionId>/<YYYYMMDD>-<uuid>-<safeName>.pdf
//
const express = require('express');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const dayjs = require('dayjs');
const { randomUUID } = require('crypto');

const { s3, BUCKET, putObject, deleteObject, listAll } = require('../utils/r2');
const {
  GetObjectCommand,
  PutObjectCommand,
  CopyObjectCommand,
  DeleteObjectsCommand
} = require('@aws-sdk/client-s3');
const { getSignedUrl: presign } = require('@aws-sdk/s3-request-presigner');

// NEW: for ZIP streaming
const archiver = require('archiver');

const User = require('../../models/User');
const {
  catalogue: DOCUMENT_CATALOGUE,
  getCatalogueEntry,
  getRequiredKeys,
  getHelpfulKeys,
  summarizeCatalogue,
} = require('../services/documents/catalogue');

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

const REQUIRED_KEYS = getRequiredKeys();
const HELPFUL_KEYS = getHelpfulKeys();

async function mutateUserCatalogue(userId, mutator) {
  if (!userId) return null;
  try {
    const user = await User.findById(userId);
    if (!user) return null;

    user.usageStats = user.usageStats || {};
    const stats = user.usageStats;
    const state = (stats.documentsCatalogue && typeof stats.documentsCatalogue === 'object')
      ? stats.documentsCatalogue
      : {};
    const perFile = { ...(state.perFile || {}) };

    const shouldSave = await mutator({ user, stats, perFile });
    if (!shouldSave) return null;

    const summary = summarizeCatalogue(perFile);
    stats.documentsCatalogue = { perFile, perKey: summary.perKey };
    stats.documentsRequiredMet = summary.requiredCompleted;
    stats.documentsHelpfulMet = summary.helpfulCompleted;
    stats.documentsRequiredTotal = REQUIRED_KEYS.length;
    stats.documentsHelpfulTotal = HELPFUL_KEYS.length;
    stats.documentsProgressUpdatedAt = new Date();
    user.markModified('usageStats');
    await user.save();
    return { summary };
  } catch (err) {
    console.error('Vault catalogue mutation failed:', err);
    return null;
  }
}

async function recordCatalogueUploads(userId, catalogueKey, uploads, collectionId) {
  if (!catalogueKey || !Array.isArray(uploads) || !uploads.length) return;
  if (!getCatalogueEntry(catalogueKey)) return;

  await mutateUserCatalogue(userId, ({ perFile, stats }) => {
    const timestamp = new Date().toISOString();
    for (const upload of uploads) {
      if (!upload?.id) continue;
      perFile[upload.id] = {
        key: catalogueKey,
        collectionId: collectionId || null,
        uploadedAt: upload.uploadedAt || timestamp,
        name: upload.name || 'document.pdf',
        size: Number.isFinite(upload.size) ? upload.size : Number(upload.size) || 0,
      };
    }
    stats.documentsUploaded = (stats.documentsUploaded || 0) + uploads.length;
    return true;
  });
}

async function recordCatalogueDeletion(userId, fileId) {
  if (!fileId) return;
  await mutateUserCatalogue(userId, ({ perFile, stats }) => {
    if (!perFile[fileId]) return false;
    delete perFile[fileId];
    if (stats.documentsUploaded) {
      stats.documentsUploaded = Math.max(0, (stats.documentsUploaded || 0) - 1);
    }
    return true;
  });
}

async function recordCatalogueRename(userId, fileId, newName) {
  if (!fileId || !newName) return;
  await mutateUserCatalogue(userId, ({ perFile }) => {
    const entry = perFile[fileId];
    if (!entry) return false;
    entry.name = newName;
    return true;
  });
}

async function replaceCatalogueFileId(userId, oldId, newId, newName) {
  if (!oldId || !newId) return;
  await mutateUserCatalogue(userId, ({ perFile }) => {
    const entry = perFile[oldId];
    if (!entry) return false;
    delete perFile[oldId];
    perFile[newId] = {
      ...entry,
      name: newName || entry.name,
    };
    return true;
  });
}

async function getUserCatalogueState(userId) {
  if (!userId) return { perFile: {}, summary: summarizeCatalogue({}), updatedAt: null };
  const user = await User.findById(userId).lean();
  if (!user) return { perFile: {}, summary: summarizeCatalogue({}), updatedAt: null };
  const perFile =
    (user.usageStats && user.usageStats.documentsCatalogue && user.usageStats.documentsCatalogue.perFile) || {};
  const summary = summarizeCatalogue(perFile);
  const updatedAt = user.usageStats?.documentsProgressUpdatedAt || null;
  return { perFile, summary, updatedAt };
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

router.get('/catalogue', async (req, res) => {
  const u = getUser(req); if (!u) return res.status(401).json({ error: 'Unauthorized' });
  const { summary, updatedAt } = await getUserCatalogueState(u.id);
  const entries = {};
  for (const [key, data] of Object.entries(summary.perKey || {})) {
    entries[key] = {
      latestFileId: data.latestFileId || null,
      latestUploadedAt: data.latestUploadedAt || null,
      files: (data.files || []).map(file => ({
        id: file.id,
        name: file.name,
        size: file.size,
        uploadedAt: file.uploadedAt,
        collectionId: file.collectionId,
        viewUrl: `/api/vault/files/${file.id}/view`,
        downloadUrl: `/api/vault/files/${file.id}/download`,
        catalogueKey: key,
      })),
    };
  }

  res.json({
    catalogue: DOCUMENT_CATALOGUE,
    entries,
    progress: {
      required: { total: REQUIRED_KEYS.length, completed: summary.requiredCompleted },
      helpful: { total: HELPFUL_KEYS.length, completed: summary.helpfulCompleted },
      updatedAt,
    },
  });
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
  const { perFile } = await getUserCatalogueState(u.id);

  const items = objs.map(o => {
    const key = String(o.Key);
    const id = keyToFileId(key);
    const displayName = extractDisplayNameFromKey(key);
    const tracked = perFile[id];
    return {
      id,
      name: displayName,
      size: o.Size || 0,
      uploadedAt: o.LastModified ? new Date(o.LastModified).toISOString() : null,
      viewUrl: `/api/vault/files/${id}/view`,
      downloadUrl: `/api/vault/files/${id}/download`,
      catalogueKey: tracked?.key || null,
    };
  }).sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));
  res.json(items);
});

router.post('/collections/:id/files', upload.array('files'), async (req, res) => {
  const u = getUser(req); if (!u) return res.status(401).json({ error: 'Unauthorized' });
  const colId = String(req.params.id);
  const cols = await loadCollectionsDoc(u.id);
  if (!cols.some(c => c.id === colId)) return res.status(404).json({ error: 'Collection not found' });

  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'No files uploaded' });

  const catalogueKeyRaw = req.body?.catalogueKey;
  const catalogueKeyInput = Array.isArray(catalogueKeyRaw) ? catalogueKeyRaw[0] : catalogueKeyRaw;
  const trimmedCatalogueKey = catalogueKeyInput ? String(catalogueKeyInput).trim() : '';
  const entryForCatalogue = trimmedCatalogueKey ? getCatalogueEntry(trimmedCatalogueKey) : null;
  const normalizedCatalogueKey = entryForCatalogue?.key || null;
  const hasValidCatalogueKey = Boolean(normalizedCatalogueKey);

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
      name: safeBase,
      size: f.size || 0,
      uploadedAt: new Date().toISOString(),
      viewUrl: `/api/vault/files/${id}/view`,
      downloadUrl: `/api/vault/files/${id}/download`,
      catalogueKey: hasValidCatalogueKey ? normalizedCatalogueKey : null,
    });
  }
  if (hasValidCatalogueKey) {
    await recordCatalogueUploads(u.id, normalizedCatalogueKey, uploaded, colId);
  }
  res.status(201).json({ uploaded });
});

router.delete('/files/:id', async (req, res) => {
  const u = getUser(req); if (!u) return res.status(401).json({ error: 'Unauthorized' });
  const fileId = String(req.params.id || '');
  const key = fileIdToKey(fileId);
  if (!key.startsWith(userPrefix(u.id))) return res.status(403).json({ error: 'Forbidden' });
  await deleteObject(key).catch(() => {});
  await recordCatalogueDeletion(u.id, fileId);
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
  const oldId = String(req.params.id || '');
  const oldKey = fileIdToKey(oldId);
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
    await recordCatalogueRename(u.id, oldId, safeBase);
    return res.json({
      id, name: safeBase,
      viewUrl: `/api/vault/files/${id}/view`,
      downloadUrl: `/api/vault/files/${id}/download`
    });
  }

  await s3.send(new CopyObjectCommand({ Bucket: BUCKET, Key: newKey, CopySource: `/${BUCKET}/${encodeURIComponent(oldKey)}` }));
  await deleteObject(oldKey);

  const newId = keyToFileId(newKey);
  await replaceCatalogueFileId(u.id, oldId, newId, safeBase);
  res.json({
    id: newId, name: safeBase,
    viewUrl: `/api/vault/files/${newId}/view`,
    downloadUrl: `/api/vault/files/${newId}/download`
  });
});

// NEW: Delete entire collection and all contained files
router.delete('/collections/:id', async (req, res) => {
  const u = getUser(req); if (!u) return res.status(401).json({ error: 'Unauthorized' });
  const colId = String(req.params.id || '');
  if (!colId) return res.status(400).json({ error: 'Missing collection id' });

  // Ensure the collection exists for this user
  const cols = await loadCollectionsDoc(u.id);
  if (!cols.some(c => c.id === colId)) return res.status(404).json({ error: 'Collection not found' });

  // List all objects with this prefix
  const prefix = collectionPrefix(u.id, colId);
  const objs = await listAll(prefix);
  const toDelete = objs
    .filter(o => String(o.Key).startsWith(prefix))
    .map(o => ({ Key: o.Key }));

  // Batch delete in chunks of 1000 (S3 limit per request)
  for (let i = 0; i < toDelete.length; i += 1000) {
    const chunk = toDelete.slice(i, i + 1000);
    await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: chunk } }));
  }

  // Remove collection entry from control doc
  const remaining = cols.filter(c => c.id !== colId);
  await saveCollectionsDoc(u.id, remaining);

  res.json({ ok: true, removed: { objects: toDelete.length, collectionId: colId } });
});

// NEW: Download an entire collection as a ZIP (streamed)
router.get('/collections/:id/archive', async (req, res) => {
  const u = getUser(req); if (!u) return res.status(401).json({ error: 'Unauthorized' });
  const colId = String(req.params.id || '');
  if (!colId) return res.status(400).json({ error: 'Missing collection id' });

  // Verify ownership and get collection name for filename
  const cols = await loadCollectionsDoc(u.id);
  const col = cols.find(c => c.id === colId);
  if (!col) return res.status(404).json({ error: 'Collection not found' });
  const zipName = `${col.name || 'collection'}.zip`.replace(/[\\/:*?"<>|]+/g, '_');

  // List files for this collection
  const prefix = collectionPrefix(u.id, colId);
  const objs = (await listAll(prefix)).filter(o => !String(o.Key).endsWith('/'));
  if (!objs.length) {
    // Return an empty ZIP rather than 404 for a better UX
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(zipName)}"`);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', err => { try { res.status(500).end(); } catch {} });
    archive.pipe(res);
    await archive.finalize();
    return;
  }

  // Stream ZIP
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(zipName)}"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', err => { try { res.status(500).end(); } catch {} });
  archive.pipe(res);

  // Append each R2 object as <displayName>
  for (const o of objs) {
    const key = String(o.Key);
    const entryName = extractDisplayNameFromKey(key);
    try {
      const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
      archive.append(obj.Body, { name: entryName });
    } catch {
      // Skip missing/unreadable objects
    }
  }

  await archive.finalize();
});

module.exports = router;
