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

// NEW: for ZIP streaming (optional dependency)
let archiver;
try {
  archiver = require('archiver');
} catch (err) {
  archiver = null;
  console.warn('⚠️  archiver not available – collection ZIP exports disabled.');
}

const User = require('../../models/User');
const {
  catalogue: DOCUMENT_CATALOGUE,
  getCatalogueEntry,
  getKeysByCategory,
  summarizeCatalogue,
} = require('../services/documents/catalogue');
const { analyseDocument } = require('../services/documents/ingest');
const { applyDocumentInsights, setInsightsProcessing } = require('../services/documents/insightsStore');

const REQUIRED_KEYS = getKeysByCategory('required');
const HELPFUL_KEYS = getKeysByCategory('helpful');
const ANALYTICS_KEYS = getKeysByCategory('analytics');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB

const DEFAULT_COLLECTIONS = [
  { id: 'default-required', name: 'Required evidence', locked: true, category: 'required' },
  { id: 'default-analytics', name: 'Analytics sources', locked: true, category: 'analytics' },
  { id: 'default-helpful', name: 'Helpful extras', locked: true, category: 'helpful' },
];

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

function catalogueCollectionId(key) {
  return `catalogue-${key}`;
}

async function ensureCatalogueStorageCollection(userId, key) {
  const entry = getCatalogueEntry(key);
  const storageId = catalogueCollectionId(key);
  const cols = await loadCollectionsDoc(userId);
  if (!cols.some((c) => c.id === storageId)) {
    cols.push({
      id: storageId,
      name: `${entry?.label || key} storage`,
      system: true,
      hidden: true,
      locked: true,
      category: null,
    });
    await saveCollectionsDoc(userId, cols);
    await putObject(collectionPrefix(userId, storageId), Buffer.alloc(0), 'application/x-directory').catch(() => {});
  }
  return storageId;
}

// Extract a user-facing filename from an R2 object key tail.
// If the tail matches YYYYMMDD-UUID-name.pdf, return just "name.pdf".
function extractDisplayNameFromKey(key) {
  const tail = String(key).split('/').pop() || 'file.pdf';
  const m = tail.match(/^(\d{8})-([0-9a-fA-F-]{36})-(.+)$/i);
  return m ? m[3] : tail;
}

function docMatchesFile(doc, file) {
  const hay = `${file.name || ''} ${file.collectionName || ''}`.toLowerCase();
  if (!hay.trim()) return false;
  const probes = new Set();
  const key = String(doc.key || '');
  if (key) probes.add(key.toLowerCase().replace(/_/g, ' '));
  const label = String(doc.label || '');
  if (label) probes.add(label.toLowerCase());
  const aliases = Array.isArray(doc.aliases) ? doc.aliases : [];
  aliases.forEach(a => probes.add(String(a || '').toLowerCase()));
  // Individual words from label (>=3 chars) to widen match but avoid noise
  label
    .split(/[^a-z0-9]+/i)
    .map(w => w.toLowerCase())
    .filter(w => w.length >= 3)
    .forEach(w => probes.add(w));
  for (const probe of probes) {
    if (!probe) continue;
    if (hay.includes(probe)) return true;
  }
  return false;
}

// ---- collections control doc ----
async function loadCollectionsDoc(userId) {
  try {
    const url = await presign(s3, new GetObjectCommand({ Bucket: BUCKET, Key: collectionsKey(userId) }), { expiresIn: 60 });
    const res = await fetch(url);
    if (!res.ok) throw new Error('not found');
    const json = await res.json();
    const arrRaw = Array.isArray(json?.collections) ? json.collections : Array.isArray(json) ? json : [];
    const cleaned = arrRaw
      .map((c) => ({
        id: String(c.id || c._id || c.collectionId || ''),
        name: String(c.name || c.title || 'Untitled'),
        locked: Boolean(c.locked),
        category: c.category ? String(c.category) : null,
        system: Boolean(c.system),
        hidden: Boolean(c.hidden),
      }))
      .filter((c) => c.id);

    const existingIds = new Set(cleaned.map((c) => c.id));
    let mutated = false;
    for (const def of DEFAULT_COLLECTIONS) {
      if (existingIds.has(def.id)) continue;
      cleaned.push({ ...def, system: true, hidden: false });
      mutated = true;
    }
    if (mutated) await saveCollectionsDoc(userId, cleaned);
    return cleaned;
  } catch {
    // ensure defaults persisted if doc missing
    await saveCollectionsDoc(userId, DEFAULT_COLLECTIONS.map((c) => ({ ...c, system: true, hidden: false }))).catch(() => {});
    return DEFAULT_COLLECTIONS.map((c) => ({ ...c, system: true, hidden: false }));
  }
}
async function saveCollectionsDoc(userId, arr) {
  const payload = Buffer.from(JSON.stringify({ collections: arr }, null, 2));
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: collectionsKey(userId), Body: payload, ContentType: 'application/json' }));
}
async function computeCollectionMetrics(userId, cols) {
  const state = await getUserCatalogueState(userId);
  const out = [];
  for (const c of cols) {
    if (c.hidden) continue;
    if (c.category) {
      const categoryKey = String(c.category).toLowerCase();
      const perFileEntries = Object.entries(state.perFile || {})
        .map(([id, info]) => ({ id, info }))
        .filter(({ info }) => Array.isArray(info.categories) && info.categories.includes(categoryKey));
      const bytes = perFileEntries.reduce((total, { info }) => total + (Number(info.size) || 0), 0);
      out.push({
        id: c.id,
        name: c.name,
        fileCount: perFileEntries.length,
        bytes,
        locked: !!c.locked,
        category: c.category,
        system: true,
      });
      continue;
    }
    const objs = await listAll(collectionPrefix(userId, c.id));
    const files = objs.filter(o => !String(o.Key).endsWith('/'));
    out.push({
      id: c.id,
      name: c.name,
      fileCount: files.length,
      bytes: files.reduce((n, o) => n + (o.Size || 0), 0),
      locked: !!c.locked,
      category: c.category || null,
      system: !!c.system,
    });
  }
  return out;
}

function normalizePerFile(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [idRaw, info] of Object.entries(raw)) {
    const id = String(idRaw || '').trim();
    if (!id) continue;
    if (!info || typeof info !== 'object') continue;
    const entry = getCatalogueEntry(info.key);
    if (!entry) continue;
    out[id] = {
      key: entry.key,
      collectionId: info.collectionId ? String(info.collectionId) : null,
      uploadedAt: info.uploadedAt || null,
      name: info.name || null,
      size: Number.isFinite(info.size) ? info.size : Number(info.size) || 0,
      categories: Array.isArray(info.categories) && info.categories.length
        ? Array.from(new Set(info.categories.map((c) => String(c || '').toLowerCase()).filter(Boolean)))
        : entry.categories || [],
    };
  }
  return out;
}

function buildStateFromDoc(doc) {
  const state = doc?.usageStats?.documentsCatalogue || {};
  const perFile = normalizePerFile(state.perFile || {});
  const summary = summarizeCatalogue(perFile);
  return {
    ...summary,
    updatedAt: state.updatedAt || doc?.usageStats?.documentsProgressUpdatedAt || null,
    processing: doc?.documentInsights?.processing || {},
  };
}

async function persistCatalogueState(userId, perFile) {
  const summary = summarizeCatalogue(perFile);
  const nowIso = new Date().toISOString();
  await User.findByIdAndUpdate(
    userId,
    {
      $set: {
        'usageStats.documentsCatalogue.perFile': summary.perFile,
        'usageStats.documentsCatalogue.perKey': summary.perKey,
        'usageStats.documentsCatalogue.requiredCompleted': summary.requiredCompleted,
        'usageStats.documentsCatalogue.helpfulCompleted': summary.helpfulCompleted,
        'usageStats.documentsCatalogue.analyticsCompleted': summary.analyticsCompleted,
        'usageStats.documentsCatalogue.categories': summary.categories,
        'usageStats.documentsCatalogue.updatedAt': nowIso,
        'usageStats.documentsRequiredMet': summary.requiredCompleted,
        'usageStats.documentsRequiredCompleted': summary.requiredCompleted,
        'usageStats.documentsHelpfulMet': summary.helpfulCompleted,
        'usageStats.documentsHelpfulCompleted': summary.helpfulCompleted,
        'usageStats.documentsAnalyticsMet': summary.analyticsCompleted,
        'usageStats.documentsAnalyticsCompleted': summary.analyticsCompleted,
        'usageStats.documentsRequiredTotal': REQUIRED_KEYS.length,
        'usageStats.documentsHelpfulTotal': HELPFUL_KEYS.length,
        'usageStats.documentsAnalyticsTotal': ANALYTICS_KEYS.length,
        'usageStats.documentsProgressUpdatedAt': nowIso,
      },
    },
    { strict: false }
  ).exec().catch(() => {});
  return { ...summary, updatedAt: nowIso };
}

async function updateCatalogueState(userId, mutator) {
  if (!userId) return null;
  const doc = await User.findById(userId, 'usageStats.documentsCatalogue').lean();
  if (!doc) return null;
  const perFile = normalizePerFile(doc?.usageStats?.documentsCatalogue?.perFile || {});
  const changed = await mutator(perFile);
  if (!changed) {
    return buildStateFromDoc(doc);
  }
  return persistCatalogueState(userId, perFile);
}

async function getUserCatalogueState(userId) {
  if (!userId) return { perFile: {}, perKey: {}, requiredCompleted: 0, helpfulCompleted: 0, updatedAt: null };
  const doc = await User.findById(userId, 'usageStats.documentsCatalogue documentInsights.processing').lean();
  if (!doc) return { perFile: {}, perKey: {}, requiredCompleted: 0, helpfulCompleted: 0, updatedAt: null };
  return buildStateFromDoc(doc);
}

async function recordCatalogueUploads(userId, key, files, collectionId) {
  if (!userId || !key || !Array.isArray(files) || !files.length) return;
  const entry = getCatalogueEntry(key);
  await updateCatalogueState(userId, (perFile) => {
    let changed = false;
    for (const file of files) {
      const id = String(file?.id || '').trim();
      if (!id) continue;
      perFile[id] = {
        key,
        collectionId: collectionId ? String(collectionId) : null,
        uploadedAt: file?.uploadedAt || new Date().toISOString(),
        name: file?.name || null,
        size: Number.isFinite(file?.size) ? file.size : Number(file?.size) || 0,
        categories: entry?.categories || [],
      };
      changed = true;
    }
    return changed;
  });
}

async function recordCatalogueDeletion(userId, fileId) {
  if (!userId || !fileId) return;
  await updateCatalogueState(userId, (perFile) => {
    const id = String(fileId || '').trim();
    if (!id || !perFile[id]) return false;
    delete perFile[id];
    return true;
  });
}

async function replaceCatalogueFileId(userId, oldId, newId, name) {
  if (!userId || !oldId || !newId) return;
  await updateCatalogueState(userId, (perFile) => {
    const oldKey = String(oldId || '').trim();
    const newKey = String(newId || '').trim();
    if (!oldKey || !newKey) return false;
    const info = perFile[oldKey];
    if (!info) return false;
    delete perFile[oldKey];
    perFile[newKey] = {
      ...info,
      name: name || info.name || null,
    };
    return true;
  });
}

async function recordCatalogueRename(userId, fileId, name) {
  if (!userId || !fileId) return;
  await updateCatalogueState(userId, (perFile) => {
    const id = String(fileId || '').trim();
    if (!id || !perFile[id]) return false;
    perFile[id] = { ...perFile[id], name: name || perFile[id].name || null };
    return true;
  });
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

  const [cols, objects, state] = await Promise.all([
    loadCollectionsDoc(u.id),
    listAll(userPrefix(u.id)),
    getUserCatalogueState(u.id)
  ]);

  const colNameById = new Map(cols.map(c => [String(c.id), String(c.name || '')]));

  const files = objects
    .filter(o => !String(o.Key).endsWith('/'))
    .map(o => {
      const key = String(o.Key);
      const id = keyToFileId(key);
      const parts = key.split('/');
      const collectionId = parts[1] || '';
      const name = extractDisplayNameFromKey(key);
      return {
        id,
        name,
        size: o.Size || 0,
        uploadedAt: o.LastModified ? new Date(o.LastModified).toISOString() : null,
        collectionId,
        collectionName: colNameById.get(collectionId) || null,
        viewUrl: `/api/vault/files/${id}/view`,
        downloadUrl: `/api/vault/files/${id}/download`
      };
    });

  const fileMap = new Map(files.map(f => [f.id, f]));

  const catalogue = [];
  const entries = {};

  for (const doc of DOCUMENT_CATALOGUE) {
    const meta = {
      key: doc.key,
      label: doc.label,
      required: doc.categories?.includes?.('required') || !!doc.required,
      analytics: doc.categories?.includes?.('analytics') || false,
      cadence: doc.cadence || null,
      why: doc.why || '',
      where: doc.where || '',
      categories: doc.categories || [],
    };
    catalogue.push(meta);

    const tracked = Array.isArray(state?.perKey?.[doc.key]?.files)
      ? state.perKey[doc.key].files
      : [];
    const processingState = state?.processing?.[doc.key] || null;

    const trackedFiles = tracked.map(info => {
      const stored = fileMap.get(info.id) || {};
      const isProcessing = Boolean(processingState?.active && processingState.fileId === info.id);
      return {
        id: info.id,
        name: info.name || stored.name || 'document.pdf',
        size: Number.isFinite(info.size) ? info.size : stored.size || 0,
        uploadedAt: info.uploadedAt || stored.uploadedAt || null,
        collectionId: info.collectionId || stored.collectionId || null,
        collectionName: stored.collectionName || null,
        viewUrl: stored.viewUrl || `/api/vault/files/${info.id}/view`,
        downloadUrl: stored.downloadUrl || `/api/vault/files/${info.id}/download`,
        categories: Array.isArray(info.categories) ? info.categories : doc.categories || [],
        processing: isProcessing,
        processingState,
      };
    });

    const trackedIds = new Set(trackedFiles.map(f => f.id));
    const heuristicMatches = files
      .filter(f => !trackedIds.has(f.id) && docMatchesFile(doc, f))
      .map(f => ({
        id: f.id,
        name: f.name,
        size: f.size,
        uploadedAt: f.uploadedAt,
        collectionId: f.collectionId,
        collectionName: f.collectionName,
        viewUrl: f.viewUrl,
        downloadUrl: f.downloadUrl,
        processing: Boolean(processingState?.active && processingState.fileId === f.id),
        processingState,
      }));

    const combined = [...trackedFiles, ...heuristicMatches]
      .sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));

    entries[doc.key] = {
      files: combined,
      latestFileId: state?.perKey?.[doc.key]?.latestFileId || combined[0]?.id || null,
      latestUploadedAt: state?.perKey?.[doc.key]?.latestUploadedAt || combined[0]?.uploadedAt || null,
      categories: doc.categories || [],
      processing: processingState,
    };
  }

  res.json({
    catalogue,
    entries,
    progress: {
      required: { total: REQUIRED_KEYS.length, completed: state?.requiredCompleted || 0 },
      helpful: { total: HELPFUL_KEYS.length, completed: state?.helpfulCompleted || 0 },
      analytics: { total: ANALYTICS_KEYS.length, completed: state?.analyticsCompleted || 0 },
      categories: state?.categories || {},
      updatedAt: state?.updatedAt || null,
    },
    processing: state?.processing || {},
  });
});

router.get('/collections', async (req, res) => {
  const u = getUser(req); if (!u) return res.status(401).json({ error: 'Unauthorized' });
  const all = await loadCollectionsDoc(u.id);
  const visible = all.filter((c) => !c.hidden);
  const metrics = await computeCollectionMetrics(u.id, visible);
  const metricMap = new Map(metrics.map((m) => [m.id, m]));
  const collections = visible.map((c) => ({
    id: c.id,
    name: c.name,
    locked: !!c.locked,
    category: c.category || null,
    system: !!c.system,
    fileCount: metricMap.get(c.id)?.fileCount || 0,
    bytes: metricMap.get(c.id)?.bytes || 0,
  }));
  res.json({ collections });
});

router.post('/collections', async (req, res) => {
  const u = getUser(req); if (!u) return res.status(401).json({ error: 'Unauthorized' });
  const name = String(req.body?.name || '').trim() || 'Untitled';
  const id = randomUUID();
  const curr = await loadCollectionsDoc(u.id);
  curr.push({ id, name, locked: false, system: false, hidden: false });
  await saveCollectionsDoc(u.id, curr);
  await putObject(collectionPrefix(u.id, id), Buffer.alloc(0), 'application/x-directory').catch(() => {});
  res.json({ collection: { id, name, fileCount: 0, bytes: 0 } });
});

router.get('/collections/:id/files', async (req, res) => {
  const u = getUser(req); if (!u) return res.status(401).json({ error: 'Unauthorized' });
  const colId = String(req.params.id);
  const cols = await loadCollectionsDoc(u.id);
  const collection = cols.find((c) => c.id === colId);
  if (!collection || collection.hidden) return res.status(404).json({ error: 'Collection not found' });

  const state = await getUserCatalogueState(u.id);
  if (collection.category) {
    const categoryKey = String(collection.category).toLowerCase();
    const perFileEntries = Object.entries(state.perFile || {})
      .map(([id, info]) => ({ id, info }))
      .filter(({ info }) => Array.isArray(info.categories) && info.categories.includes(categoryKey));
    const files = perFileEntries.map(({ id, info }) => {
      const perKeyEntry = state.perKey?.[info.key];
      const tracked = perKeyEntry?.files?.find?.((f) => f.id === id) || {};
      return {
        id,
        name: info.name || tracked.name || 'document.pdf',
        size: Number(info.size) || 0,
        uploadedAt: info.uploadedAt || tracked.uploadedAt || null,
        viewUrl: `/api/vault/files/${id}/view`,
        downloadUrl: `/api/vault/files/${id}/download`,
        catalogueKey: info.key,
        categories: info.categories,
      };
    }).sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));
    return res.json(files);
  }

  const pref = collectionPrefix(u.id, colId);
  const objs = (await listAll(pref)).filter(o => !String(o.Key).endsWith('/'));
  const { perFile } = state;

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
  const targetCollection = cols.find((c) => c.id === colId && !c.hidden);
  if (!targetCollection) return res.status(404).json({ error: 'Collection not found' });

  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'No files uploaded' });

  const userDoc = await User.findById(u.id, 'firstName lastName username').lean();
  if (!userDoc) return res.status(404).json({ error: 'User not found' });
  const userContext = {
    fullName: [userDoc.firstName, userDoc.lastName].filter(Boolean).join(' ').trim() || null,
    firstName: userDoc.firstName || null,
    lastName: userDoc.lastName || null,
    username: userDoc.username || null,
    aliases: [userDoc.username].filter(Boolean),
  };

  const catalogueKeyRaw = req.body?.catalogueKey;
  const catalogueKeyInput = Array.isArray(catalogueKeyRaw) ? catalogueKeyRaw[0] : catalogueKeyRaw;
  const trimmedCatalogueKey = catalogueKeyInput ? String(catalogueKeyInput).trim() : '';
  const entryForCatalogue = trimmedCatalogueKey ? getCatalogueEntry(trimmedCatalogueKey) : null;
  const normalizedCatalogueKey = entryForCatalogue?.key || null;
  const hasValidCatalogueKey = Boolean(normalizedCatalogueKey);

  if (!hasValidCatalogueKey) {
    return res.status(400).json({ error: 'Select a document type before uploading.' });
  }

  const storageCollectionId = targetCollection.category
    ? await ensureCatalogueStorageCollection(u.id, normalizedCatalogueKey)
    : colId;

  const uploaded = [];
  const analyses = [];
  await setInsightsProcessing(u.id, normalizedCatalogueKey, {
    active: true,
    message: `Analysing ${entryForCatalogue?.label || 'document'}…`,
  });
  try {
    for (const f of files) {
      const ok = f.mimetype === 'application/pdf' || /\.pdf$/i.test(f.originalname || '');
      if (!ok) {
        await setInsightsProcessing(u.id, normalizedCatalogueKey, { active: false, message: 'Only PDF files are allowed.' });
        return res.status(400).json({ error: 'Only PDF files are allowed' });
      }

      const analysis = await analyseDocument(
        entryForCatalogue,
        f.buffer,
        f.originalname || 'document.pdf',
        { user: userContext }
      );
      if (!analysis.valid) {
        await setInsightsProcessing(u.id, normalizedCatalogueKey, { active: false, message: analysis.reason || 'Document type could not be recognised.' });
        return res.status(400).json({ error: analysis.reason || 'Document type could not be recognised.' });
      }

      const date = dayjs().format('YYYYMMDD');
      const safeBase = String(f.originalname || 'file.pdf').replace(/[^\w.\- ]+/g, '_');
      const key = `${u.id}/${storageCollectionId}/${date}-${randomUUID()}-${safeBase}`;
      await putObject(key, f.buffer, 'application/pdf');
      const id = keyToFileId(key);
      await setInsightsProcessing(u.id, normalizedCatalogueKey, {
        active: true,
        message: `Extracting insights from ${safeBase}…`,
        step: 'analyse',
        fileId: id,
        fileName: safeBase,
      });
      uploaded.push({
        id,
        name: safeBase,
        size: f.size || 0,
        uploadedAt: new Date().toISOString(),
        viewUrl: `/api/vault/files/${id}/view`,
        downloadUrl: `/api/vault/files/${id}/download`,
        catalogueKey: hasValidCatalogueKey ? normalizedCatalogueKey : null,
      });
      analyses.push({
        fileId: id,
        insights: analysis.insights,
        fileName: safeBase,
        uploadedAt: new Date(),
      });
    }
    if (hasValidCatalogueKey) {
      await recordCatalogueUploads(u.id, normalizedCatalogueKey, uploaded, storageCollectionId);
    }
    for (const item of analyses) {
      await applyDocumentInsights(u.id, normalizedCatalogueKey, item.insights, {
        id: item.fileId,
        name: item.fileName,
        uploadedAt: item.uploadedAt,
      });
    }
    await setInsightsProcessing(u.id, normalizedCatalogueKey, {
      active: false,
      message: `${entryForCatalogue?.label || 'Document'} analytics updated`,
      fileId: analyses[analyses.length - 1]?.fileId || null,
      fileName: analyses[analyses.length - 1]?.fileName || null,
    });
    res.status(201).json({ uploaded });
  } catch (err) {
    await setInsightsProcessing(u.id, normalizedCatalogueKey, {
      active: false,
      message: 'Document processing failed',
    });
    throw err;
  }
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
  const col = cols.find(c => c.id === colId);
  if (!col) return res.status(404).json({ error: 'Collection not found' });
  if (col.locked) return res.status(403).json({ error: 'Default collections cannot be deleted' });

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
  if (!archiver) return res.status(503).json({ error: 'Archive support unavailable' });

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
