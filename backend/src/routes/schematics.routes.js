const express = require('express');
const mongoose = require('mongoose');
const dayjs = require('dayjs');

const auth = require('../../middleware/auth');
const DocumentSchematic = require('../../models/DocumentSchematic');
const { set: kvSet, lpush } = require('../lib/kv');

const router = express.Router();

router.use(auth);

function normaliseRules(rules) {
  if (rules && typeof rules === 'object') return rules;
  return {};
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

router.post('/schematics', async (req, res) => {
  const { docType, name, rules, fingerprint = null } = req.body || {};
  if (!docType || !name) {
    return res.status(400).json({ error: 'docType and name are required' });
  }
  try {
    const doc = await DocumentSchematic.create({
      userId: req.user.id,
      docType,
      name,
      rules: normaliseRules(rules),
      fingerprint,
      status: 'draft',
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
  doc.set({
    name: req.body.name || doc.name,
    docType: req.body.docType || doc.docType,
    rules: normaliseRules(req.body.rules) || doc.rules,
    fingerprint: req.body.fingerprint ?? doc.fingerprint,
  });
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
