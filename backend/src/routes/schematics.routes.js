const express = require('express');
const mongoose = require('mongoose');
const dayjs = require('dayjs');
const path = require('path');
const multer = require('multer');
const { randomUUID } = require('crypto');

const auth = require('../../middleware/auth');
const DocumentSchematic = require('../../models/DocumentSchematic');
const { set: kvSet, get: kvGet, lpush } = require('../lib/kv');

const parseWorkerDist = path.resolve(__dirname, '../../../apps/parse-worker/dist');
let extractFields;
let suggestAnchors;
let extractText;
let utils;
try {
  // eslint-disable-next-line import/no-dynamic-require, global-require
  ({ extractFields, suggestAnchors } = require(path.join(parseWorkerDist, 'fields.js')));
  // eslint-disable-next-line import/no-dynamic-require, global-require
  ({ extractText } = require(path.join(parseWorkerDist, 'text-extraction.js')));
  // eslint-disable-next-line import/no-dynamic-require, global-require
  utils = require(path.join(parseWorkerDist, 'utils.js'));
} catch (err) {
  console.error('[schematics] Failed to load parse-worker helpers', err);
  extractFields = null;
  suggestAnchors = null;
  extractText = null;
  utils = { normaliseWhitespace: (value) => String(value || '').trim() };
}

if (!extractText) {
  console.warn('[schematics] Falling back to basic text extractor');
  extractText = async (buffer) => {
    if (!buffer) return '';
    if (Buffer.isBuffer(buffer)) return buffer.toString('utf8');
    if (typeof buffer === 'string') return buffer;
    try {
      return Buffer.from(buffer).toString('utf8');
    } catch (err) {
      console.warn('[schematics] Unable to coerce buffer for fallback extractor', err);
      return '';
    }
  };
}

if (!extractFields) {
  console.warn('[schematics] Falling back to no-op field extraction');
  extractFields = () => ({ values: {}, issues: ['Preview worker unavailable'], usedRuleFields: [] });
}

if (!suggestAnchors) {
  console.warn('[schematics] Falling back to empty anchor suggestions');
  suggestAnchors = () => [];
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const router = express.Router();

router.use(auth);

const normaliseWhitespace = typeof (utils && utils.normaliseWhitespace) === 'function'
  ? (value) => utils.normaliseWhitespace(String(value || ''))
  : (value) => String(value || '').trim();

const SESSION_TTL_SECONDS = 60 * 60 * 6;
const memorySessions = new Map();

function sessionKey(id) {
  return `schematic:session:${id}`;
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function readSessionRecord(id) {
  if (!id) return null;
  const key = sessionKey(id);
  const raw = (await kvGet(key)) ?? memorySessions.get(key) ?? null;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.warn('[schematics] unable to parse session payload', err);
    return null;
  }
}

function normaliseSample(sample) {
  if (!sample || typeof sample !== 'object') return null;
  const uploadedAt = sample.uploadedAt ? new Date(sample.uploadedAt) : null;
  return {
    id: typeof sample.id === 'string' && sample.id.trim() ? sample.id.trim() : null,
    name: typeof sample.name === 'string' && sample.name.trim() ? sample.name.trim() : null,
    size: Number.isFinite(Number(sample.size)) ? Number(sample.size) : null,
    mimeType: typeof sample.mimeType === 'string' && sample.mimeType.trim() ? sample.mimeType.trim() : null,
    uploadedAt: uploadedAt && !Number.isNaN(uploadedAt.getTime()) ? uploadedAt.toISOString() : null,
    storagePath: typeof sample.storagePath === 'string' && sample.storagePath.trim() ? sample.storagePath.trim() : null,
    notes: typeof sample.notes === 'string' ? sample.notes : '',
  };
}

function normalisePalette(palette) {
  if (!palette || typeof palette !== 'object') return null;
  const keys = ['primary', 'secondary', 'accent', 'background', 'text'];
  const result = {};
  keys.forEach((key) => {
    if (typeof palette[key] === 'string' && palette[key].trim()) {
      result[key] = palette[key].trim();
    }
  });
  return Object.keys(result).length ? result : null;
}

function normaliseColumnTemplate(template) {
  if (!template || typeof template !== 'object') return null;
  const name = typeof template.name === 'string' && template.name.trim() ? template.name.trim() : null;
  const description = typeof template.description === 'string' ? template.description.trim() : '';
  const fields = Array.isArray(template.fields)
    ? template.fields.map((field) => String(field || '').trim()).filter((field) => field.length > 0)
    : [];
  return {
    name,
    description,
    fields,
  };
}

function ensureFieldMappings(input) {
  if (!input || typeof input !== 'object') return {};
  const cleaned = {};
  Object.entries(input).forEach(([rawKey, value]) => {
    if (typeof rawKey !== 'string') return;
    const key = rawKey.trim();
    if (!key) return;
    if (!value || typeof value !== 'object') return;
    const strategy = typeof value.strategy === 'string' ? value.strategy : 'anchor+regex';
    const expectedType = ['number', 'string', 'date'].includes(value.expectedType)
      ? value.expectedType
      : 'string';
    const base = {
      strategy,
      expectedType,
    };
    if (typeof value.anchor === 'string' && value.anchor.trim()) {
      base.anchor = value.anchor.trim();
    }
    if (strategy === 'line-offset') {
      base.lineOffset = Number.isInteger(value.lineOffset) ? value.lineOffset : 0;
    } else if (strategy === 'box') {
      base.top = Number.isFinite(Number(value.top)) ? Number(value.top) : 0;
      base.left = Number.isFinite(Number(value.left)) ? Number(value.left) : 0;
      base.width = Number.isFinite(Number(value.width)) ? Number(value.width) : 0;
      base.height = Number.isFinite(Number(value.height)) ? Number(value.height) : 0;
    } else {
      base.regex = typeof value.regex === 'string' ? value.regex : '';
    }
    if (Object.prototype.hasOwnProperty.call(value, 'sample')) {
      base.sample = value.sample;
    }
    if (typeof value.notes === 'string') {
      base.notes = value.notes;
    }
    cleaned[key] = base;
  });
  return cleaned;
}

function mergeBuilderMetadata(base, patch) {
  const current = {
    sessionId: null,
    samples: [],
    colourPalette: null,
    columnTemplates: [],
    fieldMappings: {},
    notes: '',
  };
  if (base && typeof base === 'object') {
    if (typeof base.sessionId === 'string' && base.sessionId.trim()) {
      current.sessionId = base.sessionId.trim();
    }
    if (Array.isArray(base.samples)) {
      current.samples = base.samples.map(normaliseSample).filter(Boolean);
    }
    if (base.colourPalette && typeof base.colourPalette === 'object') {
      current.colourPalette = normalisePalette(base.colourPalette);
    }
    if (Array.isArray(base.columnTemplates)) {
      current.columnTemplates = base.columnTemplates.map(normaliseColumnTemplate).filter(Boolean);
    }
    if (base.fieldMappings && typeof base.fieldMappings === 'object') {
      current.fieldMappings = ensureFieldMappings(base.fieldMappings);
    }
    if (typeof base.notes === 'string') {
      current.notes = base.notes;
    }
  }
  if (patch && typeof patch === 'object') {
    if (typeof patch.sessionId === 'string' && patch.sessionId.trim()) {
      current.sessionId = patch.sessionId.trim();
    }
    if (Array.isArray(patch.samples)) {
      current.samples = patch.samples.map(normaliseSample).filter(Boolean);
    }
    if (patch.colourPalette && typeof patch.colourPalette === 'object') {
      current.colourPalette = normalisePalette(patch.colourPalette);
    }
    if (Array.isArray(patch.columnTemplates)) {
      current.columnTemplates = patch.columnTemplates.map(normaliseColumnTemplate).filter(Boolean);
    }
    if (patch.fieldMappings && typeof patch.fieldMappings === 'object') {
      current.fieldMappings = ensureFieldMappings(patch.fieldMappings);
    }
    if (typeof patch.notes === 'string') {
      current.notes = patch.notes;
    }
  }
  if (current.colourPalette) {
    const hasColour = Object.values(current.colourPalette).some((value) => typeof value === 'string' && value.trim());
    if (!hasColour) current.colourPalette = null;
  }
  return current;
}

async function persistSessionRecord(session) {
  if (!session || !session.id) return false;
  const key = sessionKey(session.id);
  const payload = JSON.stringify(session);
  const ok = await kvSet(key, payload, SESSION_TTL_SECONDS);
  if (!ok) {
    memorySessions.set(key, payload);
  }
  return true;
}

async function loadSessionRecord(sessionId, userId) {
  if (!sessionId) return null;
  const record = await readSessionRecord(sessionId);
  if (!record) return null;
  if (record.userId && String(record.userId) !== String(userId)) {
    return null;
  }
  const hydrated = { ...record };
  hydrated.id = hydrated.id || sessionId;
  hydrated.userId = String(userId);
  hydrated.docType = hydrated.docType || 'document';
  hydrated.createdAt = hydrated.createdAt || new Date().toISOString();
  hydrated.updatedAt = hydrated.updatedAt || hydrated.createdAt;
  hydrated.fieldMappings = ensureFieldMappings(hydrated.fieldMappings);
  hydrated.anchors = Array.isArray(hydrated.anchors) ? hydrated.anchors : [];
  hydrated.issues = Array.isArray(hydrated.issues) ? hydrated.issues : [];
  hydrated.usedRuleFields = Array.isArray(hydrated.usedRuleFields) ? hydrated.usedRuleFields : [];
  hydrated.builderMetadata = mergeBuilderMetadata(hydrated.builderMetadata, {
    sessionId: hydrated.id,
    fieldMappings: hydrated.fieldMappings,
    samples: Array.isArray(hydrated.samples) ? hydrated.samples : undefined,
  });
  return hydrated;
}

function formatSessionForResponse(session) {
  const payload = { ...session };
  delete payload.userId;
  return payload;
}

function buildBuilderMetadataFromRequest(body, baseMetadata) {
  const source = body && typeof body === 'object' ? body : {};
  const rawBuilder = parseMaybeJson(source.builderMetadata);
  const builderPayload = rawBuilder && typeof rawBuilder === 'object' ? { ...rawBuilder } : {};
  const rawFieldMappings = parseMaybeJson(source.fieldMappings);
  if (source.sessionId && !builderPayload.sessionId) {
    builderPayload.sessionId = source.sessionId;
  }
  if (rawFieldMappings && !builderPayload.fieldMappings) {
    builderPayload.fieldMappings = rawFieldMappings;
  }
  return mergeBuilderMetadata(baseMetadata, builderPayload);
}

function normaliseRules(rules) {
  return ensureFieldMappings(rules);
}

function bumpVersion(current) {
  if (!current) {
    return `v${dayjs().format('YYYYMMDDHHmmss')}`;
  }
  const parts = String(current).replace(/^v/i, '').split('.');
  if (parts.length === 3 && parts.every((p) => Number.isInteger(Number(p)))) {
    const [major, minor, patch] = parts.map((p) => Number(p));
    return `v${major}.${minor}.${patch + 1}`;
  }
  return `v${dayjs().format('YYYYMMDDHHmmss')}`;
}

async function findUserDoc(id, userId) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return DocumentSchematic.findOne({ _id: id, userId }).lean();
}

router.post('/schematics/preview', upload.single('sample'), async (req, res) => {
  if (!extractText || !extractFields) {
    return res.status(503).json({ error: 'Preview worker unavailable' });
  }
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: 'sample file is required' });
  }
  const sessionId = typeof req.body?.sessionId === 'string' && req.body.sessionId.trim() ? req.body.sessionId.trim() : null;
  const existingSession = await loadSessionRecord(sessionId, req.user.id);
  const docType = String(req.body?.docType || existingSession?.docType || 'document');
  const nowIso = new Date().toISOString();

  let text;
  try {
    text = await extractText(file.buffer, docType);
  } catch (err) {
    console.error('[schematics] text extraction failed', err);
    return res.status(500).json({ error: 'Failed to extract text', detail: err.message });
  }

  const cleanedText = normaliseWhitespace(text);
  let rulesSource = parseMaybeJson(req.body?.rules) || parseMaybeJson(req.body?.fieldMappings);
  if (!rulesSource && existingSession) {
    rulesSource = existingSession.fieldMappings || existingSession.builderMetadata?.fieldMappings || {};
  }

  const ruleSet = normaliseRules(rulesSource);

  let extraction;
  try {
    extraction = extractFields(cleanedText, docType, Object.keys(ruleSet).length ? ruleSet : undefined);
  } catch (err) {
    console.error('[schematics] field extraction failed', err);
    extraction = { values: {}, issues: [err.message], usedRuleFields: [] };
  }

  let anchors = [];
  try {
    const anchorsPayload = parseMaybeJson(req.body?.anchors);
    anchors = Array.isArray(anchorsPayload)
      ? anchorsPayload.map((anchor) => String(anchor || '').trim()).filter((anchor) => anchor.length > 0)
      : suggestAnchors
      ? suggestAnchors(cleanedText)
      : [];
  } catch (err) {
    console.warn('[schematics] anchor suggestion failed', err);
    anchors = [];
  }

  const derivedSessionId = existingSession?.id || sessionId || randomUUID();
  const session = existingSession || {
    id: derivedSessionId,
    userId: String(req.user.id),
    createdAt: nowIso,
    docType,
    fieldMappings: {},
    anchors: [],
    issues: [],
    usedRuleFields: [],
    builderMetadata: mergeBuilderMetadata(null, { sessionId: derivedSessionId }),
  };

  session.id = session.id || derivedSessionId;
  session.userId = String(req.user.id);
  session.docType = docType;
  session.text = cleanedText;
  session.anchors = anchors;
  session.values = extraction.values || {};
  session.issues = Array.isArray(extraction.issues) ? extraction.issues : [];
  session.usedRuleFields = Array.isArray(extraction.usedRuleFields) ? extraction.usedRuleFields : [];
  const mappingPayload = parseMaybeJson(req.body?.fieldMappings);
  if (mappingPayload) {
    session.fieldMappings = ensureFieldMappings(mappingPayload);
  } else if (!existingSession) {
    session.fieldMappings = ensureFieldMappings(ruleSet);
  } else {
    session.fieldMappings = ensureFieldMappings(session.fieldMappings);
  }
  session.updatedAt = nowIso;
  session.createdAt = session.createdAt || nowIso;

  const sampleEntry = normaliseSample({
    id: randomUUID(),
    name: file.originalname,
    size: file.size,
    mimeType: file.mimetype || null,
    uploadedAt: nowIso,
  });
  const existingSamples = Array.isArray(session.builderMetadata?.samples)
    ? session.builderMetadata.samples.map(normaliseSample).filter(Boolean)
    : [];
  const mergedSamples = [...existingSamples, sampleEntry].filter(Boolean);

  const builderPatch = buildBuilderMetadataFromRequest(req.body, session.builderMetadata);
  builderPatch.samples = mergedSamples.slice(-5);
  if (!builderPatch.fieldMappings || !Object.keys(builderPatch.fieldMappings).length) {
    builderPatch.fieldMappings = session.fieldMappings;
  }
  builderPatch.sessionId = session.id;
  session.builderMetadata = mergeBuilderMetadata(session.builderMetadata, builderPatch);

  await persistSessionRecord(session);

  return res.json({ session: formatSessionForResponse(session) });
});

router.get('/schematics/sessions/:id', async (req, res) => {
  const session = await loadSessionRecord(req.params.id, req.user.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  return res.json({ session: formatSessionForResponse(session) });
});

router.patch('/schematics/sessions/:id', async (req, res) => {
  const session = await loadSessionRecord(req.params.id, req.user.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  if (req.body?.docType) {
    session.docType = String(req.body.docType);
  }
  const patchMappings = parseMaybeJson(req.body?.fieldMappings);
  if (patchMappings) {
    session.fieldMappings = ensureFieldMappings(patchMappings);
  }
  if (req.body?.values && typeof req.body.values === 'object') {
    session.values = { ...session.values, ...req.body.values };
  }
  const builderMetadata = buildBuilderMetadataFromRequest(req.body, session.builderMetadata);
  if (!builderMetadata.fieldMappings || !Object.keys(builderMetadata.fieldMappings).length) {
    builderMetadata.fieldMappings = session.fieldMappings;
  }
  builderMetadata.sessionId = session.id;
  session.builderMetadata = builderMetadata;
  session.updatedAt = new Date().toISOString();
  await persistSessionRecord(session);
  return res.json({ session: formatSessionForResponse(session) });
});

router.post('/schematics', async (req, res) => {
  const { docType, name, rules, fingerprint = null } = req.body || {};
  if (!docType || !name) {
    return res.status(400).json({ error: 'docType and name are required' });
  }
  try {
    const builderMetadata = buildBuilderMetadataFromRequest(req.body, null);
    const normalisedRules = normaliseRules(rules);
    const metadataWithRules = Object.keys(builderMetadata.fieldMappings || {}).length
      ? builderMetadata
      : mergeBuilderMetadata(builderMetadata, { fieldMappings: normalisedRules });
    const doc = await DocumentSchematic.create({
      userId: req.user.id,
      docType,
      name,
      rules: normalisedRules,
      fingerprint,
      status: 'draft',
      builderMetadata: metadataWithRules,
    });
    res.status(201).json(doc);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create schematic', detail: err.message });
  }
});

router.get('/schematics', async (req, res) => {
  const filter = { userId: req.user.id };
  if (req.query.docType) {
    filter.docType = String(req.query.docType);
  }
  const docs = await DocumentSchematic.find(filter).sort({ updatedAt: -1 }).lean();
  res.json({ items: docs });
});

router.get('/schematics/:id', async (req, res) => {
  const doc = await findUserDoc(req.params.id, req.user.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  return res.json(doc);
});

router.put('/schematics/:id', async (req, res) => {
  const doc = await DocumentSchematic.findOne({ _id: req.params.id, userId: req.user.id });
  if (!doc) return res.status(404).json({ error: 'Not found' });
  if (doc.status !== 'draft') {
    return res.status(400).json({ error: 'Only draft schematics can be edited' });
  }
  const updates = {
    name: req.body.name || doc.name,
    docType: req.body.docType || doc.docType,
    fingerprint: req.body.fingerprint ?? doc.fingerprint,
  };
  if (Object.prototype.hasOwnProperty.call(req.body, 'rules')) {
    updates.rules = normaliseRules(req.body.rules);
  }
  const builderMetadata = buildBuilderMetadataFromRequest(req.body, doc.builderMetadata ? doc.builderMetadata.toObject?.() || doc.builderMetadata : {});
  if (!builderMetadata.fieldMappings || !Object.keys(builderMetadata.fieldMappings).length) {
    builderMetadata.fieldMappings = updates.rules || (doc.rules || {});
  }
  builderMetadata.sessionId = builderMetadata.sessionId || req.body?.sessionId || null;
  updates.builderMetadata = builderMetadata;
  doc.set(updates);
  await doc.save();
  res.json(doc.toObject());
});

router.post('/schematics/:id/activate', async (req, res) => {
  const doc = await DocumentSchematic.findOne({ _id: req.params.id, userId: req.user.id });
  if (!doc) return res.status(404).json({ error: 'Not found' });
  const nextVersion = bumpVersion(doc.version);
  try {
    await kvSet(`map:${req.user.id}:${doc.docType}:${nextVersion}`, JSON.stringify(doc.rules || {}));
    await kvSet(`map:${req.user.id}:${doc.docType}:active`, nextVersion);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to publish to Redis', detail: err.message });
  }
  await DocumentSchematic.updateMany(
    { userId: req.user.id, docType: doc.docType, _id: { $ne: doc._id }, status: 'active' },
    { $set: { status: 'archived' } }
  );
  doc.status = 'active';
  doc.version = nextVersion;
  await doc.save();
  res.json(doc.toObject());
});

async function enqueueJobs(req, res, docIds, version, docType) {
  if (!Array.isArray(docIds) || docIds.length === 0) {
    return res.status(400).json({ error: 'docIds must be a non-empty array' });
  }
  let queued = 0;
  for (const id of docIds) {
    if (!id) continue;
    await lpush('parse:jobs', {
      docId: id,
      userId: req.user.id,
      storagePath: '',
      docType: docType || req.body.docType || 'document',
      userRulesVersion: version || null,
      source: 'schematics-apply',
    });
    console.log({
      name: 'ingest',
      msg: 'Enqueued parse job to Redis',
      docId: id,
      docType: docType || req.body.docType || 'document',
    });
    queued += 1;
  }
  return res.json({ queued });
}

router.post('/schematics/:id/test', async (req, res) => {
  const doc = await DocumentSchematic.findOne({ _id: req.params.id, userId: req.user.id });
  if (!doc) return res.status(404).json({ error: 'Not found' });
  const docIds = Array.isArray(req.body?.docIds) ? req.body.docIds : [];
  return enqueueJobs(req, res, docIds, doc.version, doc.docType);
});

router.post('/schematics/apply', async (req, res) => {
  const docIds = Array.isArray(req.body?.docIds) ? req.body.docIds : [];
  let version = req.body?.version || null;
  const docType = req.body?.docType || null;
  if (!docType) {
    return res.status(400).json({ error: 'docType is required' });
  }
  if (!version) {
    const activePointer = await DocumentSchematic.findOne({
      userId: req.user.id,
      docType,
      status: 'active',
    })
      .sort({ updatedAt: -1 })
      .lean();
    version = activePointer?.version || null;
  }
  return enqueueJobs(
    {
      ...req,
      body: { ...(req.body || {}), docType },
    },
    res,
    docIds,
    version,
    docType
  );
});

module.exports = router;
