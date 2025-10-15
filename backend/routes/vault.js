const express = require('express');
const multer = require('multer');
const dayjs = require('dayjs');
const archiver = require('archiver');
const path = require('path');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const DocumentInsight = require('../models/DocumentInsight');
const UploadSession = require('../models/UploadSession');
const VaultDocumentJob = require('../models/VaultDocumentJob');
const Account = require('../models/Account');
const { handleUpload } = require('../src/services/vault/storage');
const { extractPdfText } = require('../src/services/documents/pipeline/textExtractor');
const { classifyDocument } = require('../src/services/documents/pipeline');
const { trimBankStatement } = require('../src/services/pdf/trimBankStatement');
const VaultCollection = require('../models/VaultCollection');
const User = require('../models/User');
const { getObject, deleteObject, putObject, fileIdToKey } = require('../src/lib/r2');
const { dispatch: dispatchDocupipe, readR2Buffer } = require('../src/services/vault/docupipeDispatcher');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const router = express.Router();

router.use(auth);

const TRIM_PAGE_THRESHOLD = Number.isFinite(Number(process.env.VAULT_TRIM_WARN_PAGES))
  ? Number(process.env.VAULT_TRIM_WARN_PAGES)
  : 5;

const CLASSIFICATION_SCHEMA_MAP = {
  payslip: process.env.DOCUPIPE_PAYSLIP_SCHEMA_ID,
  current_account_statement: process.env.DOCUPIPE_BANK_SCHEMA_ID,
  savings_account_statement: process.env.DOCUPIPE_BANK_SCHEMA_ID,
  isa_statement: process.env.DOCUPIPE_BANK_SCHEMA_ID,
  investment_statement: process.env.DOCUPIPE_INVESTMENT_SCHEMA_ID || process.env.DOCUPIPE_BANK_SCHEMA_ID,
  pension_statement: process.env.DOCUPIPE_PENSION_SCHEMA_ID || process.env.DOCUPIPE_BANK_SCHEMA_ID,
  hmrc_correspondence: process.env.DOCUPIPE_HMRC_SCHEMA_ID || process.env.DOCUPIPE_BANK_SCHEMA_ID,
};

const TILE_KEY_MAP = {
  payslips: ['payslip'],
  statements: ['current_account_statement', 'savings_account_statement'],
  'savings-isa': ['savings_account_statement', 'isa_statement'],
  investments: ['investment_statement'],
  pensions: ['pension_statement'],
  hmrc: ['hmrc_correspondence'],
};

function validateFileOwnership(userId, key) {
  if (!key) return false;
  const normalizedKey = String(key);
  const firstSegment = normalizedKey.split('/')[0] || '';
  if (!firstSegment) return false;
  if (firstSegment === userId) return true;
  return firstSegment.endsWith(`-${userId}`);
}

function decodeFileKey(fileId) {
  try {
    return fileIdToKey(fileId);
  } catch (error) {
    return null;
  }
}

async function streamFile(res, key, { inline = true, filename = null } = {}) {
  try {
    const object = await getObject(key);
    if (object.ContentType) {
      res.setHeader('Content-Type', object.ContentType);
    } else {
      res.setHeader('Content-Type', 'application/pdf');
    }
    const safeName = filename || path.basename(key) || 'document.pdf';
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(safeName)}"`);
    if (object.ContentLength != null) {
      res.setHeader('Content-Length', String(object.ContentLength));
    }
    if (object.Body && typeof object.Body.pipe === 'function') {
      object.Body.pipe(res);
    } else if (object.Body && typeof object.Body.arrayBuffer === 'function') {
      const buffer = Buffer.from(await object.Body.arrayBuffer());
      res.end(buffer);
    } else {
      res.status(500).json({ error: 'Unsupported file stream' });
    }
  } catch (error) {
    console.error('streamFile error', error);
    res.status(404).json({ error: 'File not found' });
  }
}

router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const userId = req.user.id;
    const userObjectId = new mongoose.Types.ObjectId(userId);
    if (!req.file) {
      return res.status(400).json({ error: 'File is required' });
    }
    let collectionId = null;
    if (req.body?.collectionId) {
      if (!mongoose.Types.ObjectId.isValid(req.body.collectionId)) {
        return res.status(400).json({ error: 'Invalid collectionId' });
      }
      const collection = await VaultCollection.findOne({ _id: req.body.collectionId, userId: userObjectId });
      if (!collection) {
        return res.status(404).json({ error: 'Collection not found' });
      }
      collectionId = collection._id.toString();
    }
    const userPrefix = await resolveUserStoragePrefix(userObjectId, userId);
    const { sessionId, files } = await handleUpload({ userId, userPrefix, file: req.file, collectionId });

    await recordUploadSession({ userId: userObjectId, sessionId, files });

    const acceptedFiles = files.filter((file) => !file.error);
    const rejected = files
      .filter((file) => file.error)
      .map((file) => ({ originalName: file.originalName, reason: file.error }));

    const jobs = await createJobsForUploadedFiles({
      userId: userObjectId,
      sessionId,
      files: acceptedFiles,
      collectionId,
    });

    res.status(201).json({
      sessionId,
      files: jobs.map((job) => ({
        fileId: job.fileId,
        originalName: job.originalName,
        state: job.state,
        classification: job.classification,
      })),
      rejected,
    });
  } catch (error) {
    console.error('upload error', error);
    res.status(400).json({ error: error.message || 'Upload failed' });
  }
});

router.get('/upload-sessions/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const session = await UploadSession.findOne({ sessionId, userId: new mongoose.Types.ObjectId(req.user.id) });
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  res.json({
    sessionId: session.sessionId,
    summary: session.summary,
    files: session.files.map((file) => ({
      fileId: file.fileId,
      originalName: file.originalName,
      status: file.status,
      reason: file.reason,
    })),
  });
});

router.get('/files/:fileId/status', async (req, res) => {
  const { fileId } = req.params;
  const job = await VaultDocumentJob.findOne({ fileId, userId: new mongoose.Types.ObjectId(req.user.id) });
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json({
    upload: 'green',
    processing: mapVaultStateToLight(job.state),
    state: job.state,
    classification: job.classification || null,
    message: latestErrorMessage(job),
  });
});

router.get('/files/:fileId/view', async (req, res) => {
  const { fileId } = req.params;
  const key = decodeFileKey(fileId);
  if (!key) {
    return res.status(400).json({ error: 'Invalid fileId' });
  }
  if (!validateFileOwnership(req.user.id, key)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  await streamFile(res, key, { inline: true });
});

router.get('/files/:fileId/download', async (req, res) => {
  const { fileId } = req.params;
  const key = decodeFileKey(fileId);
  if (!key) {
    return res.status(400).json({ error: 'Invalid fileId' });
  }
  if (!validateFileOwnership(req.user.id, key)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  await streamFile(res, key, { inline: false });
});

router.delete('/files/:fileId', async (req, res) => {
  const { fileId } = req.params;
  const userObjectId = new mongoose.Types.ObjectId(req.user.id);
  const key = decodeFileKey(fileId);
  if (!key) {
    return res.status(400).json({ error: 'Invalid fileId' });
  }
  if (!validateFileOwnership(req.user.id, key)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  await DocumentInsight.deleteMany({ userId: userObjectId, fileId });
  await VaultDocumentJob.deleteMany({ userId: userObjectId, fileId });
  try {
    await deleteObject(key);
  } catch (error) {
    console.warn('delete file object failed', error);
  }
  res.json({ ok: true });
});

router.delete('/tiles/:tileId', async (req, res) => {
  const tileId = String(req.params.tileId || '').toLowerCase();
  const catalogueKeys = TILE_KEY_MAP[tileId];
  if (!catalogueKeys) {
    return res.status(400).json({ error: 'Unknown tile identifier' });
  }

  const userId = req.user.id;
  const userObjectId = new mongoose.Types.ObjectId(userId);

  const docs = await DocumentInsight.find({ userId: userObjectId, catalogueKey: { $in: catalogueKeys } }).select('fileId');
  if (!docs.length) {
    return res.json({ ok: true, deleted: 0, removedFromR2: 0 });
  }

  const fileIds = docs.map((doc) => doc.fileId).filter(Boolean);
  const keys = fileIds
    .map((id) => decodeFileKey(id))
    .filter((key) => key && validateFileOwnership(userId, key));

  await DocumentInsight.deleteMany({ userId: userObjectId, catalogueKey: { $in: catalogueKeys } });
  if (fileIds.length) {
    await VaultDocumentJob.deleteMany({ userId: userObjectId, fileId: { $in: fileIds } });
  }

  let removedFromR2 = 0;
  for (const key of keys) {
    try {
      await deleteObject(key);
      removedFromR2 += 1;
    } catch (error) {
      console.warn('tile delete R2 error', error);
    }
  }

  res.json({ ok: true, deleted: fileIds.length, removedFromR2 });
});

router.get('/tiles', async (req, res) => {
  const userObjectId = new mongoose.Types.ObjectId(req.user.id);
  const insights = await DocumentInsight.aggregate([
    { $match: { userId: userObjectId } },
    {
      $group: {
        _id: '$catalogueKey',
        count: { $sum: 1 },
        lastUpdated: { $max: '$updatedAt' },
      },
    },
  ]);

  const jobsInFlight = await VaultDocumentJob.countDocuments({
    userId: userObjectId,
    state: { $in: ['queued', 'processing'] },
  });

  const map = Object.fromEntries(
    insights.map((row) => [row._id, { count: row.count, lastUpdated: row.lastUpdated }])
  );

  res.json({
    tiles: {
      payslips: normaliseTile(map.payslip),
      statements: normaliseTile(map.current_account_statement),
      savings: normaliseTile(map.savings_account_statement),
      isa: normaliseTile(map.isa_statement),
      investments: normaliseTile(map.investment_statement),
      pension: normaliseTile(map.pension_statement),
      hmrc: normaliseTile(map.hmrc_correspondence),
    },
    processing: jobsInFlight,
  });
});

router.get('/payslips/employers', async (req, res) => {
  const rows = await DocumentInsight.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(req.user.id), catalogueKey: 'payslip' } },
    {
      $group: {
        _id: '$metadata.employerName',
        count: { $sum: 1 },
        lastPayDate: { $max: '$documentDate' },
      },
    },
  ]);
  res.json({
    employers: rows
      .filter((row) => row._id)
      .map((row) => ({
        employerId: Buffer.from(String(row._id)).toString('base64url'),
        name: row._id,
        count: row.count,
        lastPayDate: row.lastPayDate,
      })),
  });
});

router.get('/payslips/employers/:employerId/files', async (req, res) => {
  const employerName = Buffer.from(req.params.employerId, 'base64url').toString('utf8');
  const documents = await DocumentInsight.find({ userId: new mongoose.Types.ObjectId(req.user.id), catalogueKey: 'payslip', 'metadata.employerName': employerName }).sort({ documentDate: -1 });
  res.json({
    employer: employerName,
    files: documents.map((doc) => ({
      ...mapDocumentForResponse(doc),
      status: doc.narrative?.length ? 'processed' : 'pending',
    })),
  });
});

router.get('/statements/institutions', async (req, res) => {
  const accounts = await Account.find({ userId: new mongoose.Types.ObjectId(req.user.id) }).sort({ institutionName: 1 });
  const grouped = new Map();
  for (const account of accounts) {
    const entry = grouped.get(account.institutionName) || { institutionId: Buffer.from(account.institutionName).toString('base64url'), name: account.institutionName, accounts: 0 };
    entry.accounts += 1;
    grouped.set(account.institutionName, entry);
  }
  res.json({ institutions: Array.from(grouped.values()) });
});

router.get('/statements/institutions/:institutionId/accounts', async (req, res) => {
  const institutionName = Buffer.from(req.params.institutionId, 'base64url').toString('utf8');
  const accounts = await Account.find({ userId: new mongoose.Types.ObjectId(req.user.id), institutionName }).sort({ displayName: 1 });
  res.json({
    institution: institutionName,
    accounts: accounts.map((account) => ({
      accountId: account._id.toString(),
      displayName: account.displayName,
      accountType: account.accountType,
      accountNumberMasked: account.accountNumberMasked,
      lastSeenAt: account.lastSeenAt,
    })),
  });
});

router.get('/statements/institutions/:institutionId/files', async (req, res) => {
  const institutionName = Buffer.from(req.params.institutionId, 'base64url').toString('utf8');
  const userObjectId = new mongoose.Types.ObjectId(req.user.id);
  const accounts = await Account.find({ userId: userObjectId, institutionName }).sort({ displayName: 1 });
  const accountIds = accounts.map((account) => account._id);
  const maskedByAccount = new Map(accounts.map((account) => [account.accountNumberMasked, account._id.toString()]));
  const maskedNumbers = accounts.map((account) => account.accountNumberMasked).filter(Boolean);

  const documents = await DocumentInsight.find({
    userId: userObjectId,
    catalogueKey: { $in: ['current_account_statement', 'savings_account_statement', 'isa_statement'] },
    $or: [
      { 'metadata.accountId': { $in: accountIds } },
      maskedNumbers.length ? { 'metadata.accountNumberMasked': { $in: maskedNumbers } } : null,
    ].filter(Boolean),
  }).sort({ documentMonth: -1 });

  const jobs = await VaultDocumentJob.find({ userId: userObjectId, fileId: { $in: documents.map((doc) => doc.fileId) } }).select(
    'fileId state errors classification'
  );
  const jobMap = new Map(jobs.map((job) => [job.fileId, job]));

  const docsByAccount = new Map();
  for (const doc of documents) {
    const meta = doc.metadata || {};
    let accountId = meta.accountId ? meta.accountId.toString() : null;
    if (!accountId && meta.accountNumberMasked && maskedByAccount.has(meta.accountNumberMasked)) {
      accountId = maskedByAccount.get(meta.accountNumberMasked) || null;
    }
    if (!accountId) continue;
    const list = docsByAccount.get(accountId) || [];
    list.push({
      doc,
      job: jobMap.get(doc.fileId) || null,
    });
    docsByAccount.set(accountId, list);
  }

  res.json({
    institution: { name: institutionName, accountCount: accounts.length },
    accounts: accounts.map((account) => {
      const accountId = account._id.toString();
      const files = (docsByAccount.get(accountId) || []).map((entry) => {
        const payload = mapDocumentForResponse(entry.doc, entry.job);
        if (!payload) return null;
        payload.accountId = accountId;
        if (!payload.accountNumberMasked) {
          payload.accountNumberMasked = entry.doc?.metadata?.accountNumberMasked || account.accountNumberMasked || null;
        }
        if (!payload.metadata) payload.metadata = {};
        if (payload.metadata && typeof payload.metadata === 'object') {
          payload.metadata.accountId = accountId;
          if (!payload.metadata.accountNumberMasked) {
            payload.metadata.accountNumberMasked = payload.accountNumberMasked;
          }
          if (!payload.metadata.accountType && account.accountType) {
            payload.metadata.accountType = account.accountType;
          }
        }
        payload.accountType = account.accountType || payload.metadata?.accountType || null;
        return payload;
      }).filter(Boolean);

      return {
        accountId,
        displayName: account.displayName,
        accountType: account.accountType,
        accountNumberMasked: account.accountNumberMasked,
        files,
      };
    }),
  });
});

router.get('/statements/accounts/:accountId/files', async (req, res) => {
  const accountId = req.params.accountId;
  const account = await Account.findOne({ _id: accountId, userId: new mongoose.Types.ObjectId(req.user.id) });
  if (!account) {
    return res.status(404).json({ error: 'Account not found' });
  }
  const userObjectId = new mongoose.Types.ObjectId(req.user.id);
  const documents = await DocumentInsight.find({ userId: userObjectId, 'metadata.accountId': account._id }).sort({ documentMonth: -1 });
  const jobs = await VaultDocumentJob.find({ userId: userObjectId, fileId: { $in: documents.map((doc) => doc.fileId) } }).select(
    'fileId state errors classification'
  );
  const jobMap = new Map(jobs.map((job) => [job.fileId, job]));
  res.json({
    account: {
      displayName: account.displayName,
      accountType: account.accountType,
      accountNumberMasked: account.accountNumberMasked,
    },
    files: documents.map((doc) => mapDocumentForResponse(doc, jobMap.get(doc.fileId))),
  });
});

router.get('/collections', async (req, res) => {
  const userObjectId = new mongoose.Types.ObjectId(req.user.id);
  const collections = await VaultCollection.find({ userId: userObjectId }).sort({ name: 1 });
  const counts = await DocumentInsight.aggregate([
    { $match: { userId: userObjectId, collectionId: { $ne: null } } },
    { $group: { _id: '$collectionId', count: { $sum: 1 }, lastUpdated: { $max: '$updatedAt' } } },
  ]);
  const countMap = new Map(counts.map((row) => [String(row._id), row]));
  res.json({
    collections: collections.map((col) => {
      const stats = countMap.get(col._id.toString());
      return {
        id: col._id.toString(),
        name: col.name,
        description: col.description,
        fileCount: stats?.count || 0,
        lastUpdated: stats?.lastUpdated || null,
      };
    }),
  });
});

router.post('/collections', async (req, res) => {
  const userObjectId = new mongoose.Types.ObjectId(req.user.id);
  const name = String(req.body?.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }
  try {
    const collection = await VaultCollection.create({ userId: userObjectId, name, description: req.body?.description || '' });
    res.status(201).json({
      collection: {
        id: collection._id.toString(),
        name: collection.name,
        description: collection.description,
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ error: 'Collection name already exists' });
    }
    throw error;
  }
});

router.get('/collections/:collectionId/files', async (req, res) => {
  const { collectionId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(collectionId)) {
    return res.status(400).json({ error: 'Invalid collectionId' });
  }
  const userObjectId = new mongoose.Types.ObjectId(req.user.id);
  const collection = await VaultCollection.findOne({ _id: collectionId, userId: userObjectId });
  if (!collection) {
    return res.status(404).json({ error: 'Collection not found' });
  }
  const collectionObjectId = new mongoose.Types.ObjectId(collectionId);
  const insights = await DocumentInsight.find({ userId: userObjectId, collectionId: collectionObjectId }).sort({ updatedAt: -1 });
  const jobs = await VaultDocumentJob.find({ userId: userObjectId, collectionId: collectionObjectId }).select('fileId state errors classification');
  const jobMap = new Map(jobs.map((job) => [job.fileId, job]));
  res.json({
    collection: {
      id: collection._id.toString(),
      name: collection.name,
    },
    files: insights.map((doc) => mapDocumentForResponse(doc, jobMap.get(doc.fileId))),
  });
});

router.post('/collections/:collectionId/upload', upload.single('file'), async (req, res) => {
  const { collectionId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(collectionId)) {
    return res.status(400).json({ error: 'Invalid collectionId' });
  }
  const userId = req.user.id;
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const collection = await VaultCollection.findOne({ _id: collectionId, userId: userObjectId });
  if (!collection) {
    return res.status(404).json({ error: 'Collection not found' });
  }
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'File is required' });
    }
    const userPrefix = await resolveUserStoragePrefix(userObjectId, userId);
    const { sessionId, files } = await handleUpload({ userId, userPrefix, file: req.file, collectionId });
    await recordUploadSession({ userId: userObjectId, sessionId, files });
    const acceptedFiles = files.filter((file) => !file.error);
    const rejected = files
      .filter((file) => file.error)
      .map((file) => ({ originalName: file.originalName, reason: file.error }));
    const jobs = await createJobsForUploadedFiles({
      userId: userObjectId,
      sessionId,
      files: acceptedFiles,
      collectionId: collection._id.toString(),
    });
    res.status(201).json({
      sessionId,
      files: jobs.map((job) => ({
        fileId: job.fileId,
        originalName: job.originalName,
        state: job.state,
        classification: job.classification,
      })),
      rejected,
    });
  } catch (error) {
    console.error('collection upload error', error);
    res.status(400).json({ error: error.message || 'Upload failed' });
  }
});

router.patch('/collections/:collectionId', async (req, res) => {
  const { collectionId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(collectionId)) {
    return res.status(400).json({ error: 'Invalid collectionId' });
  }
  const name = String(req.body?.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }
  try {
    const updated = await VaultCollection.findOneAndUpdate(
      { _id: collectionId, userId: new mongoose.Types.ObjectId(req.user.id) },
      { $set: { name } },
      { new: true }
    );
    if (!updated) {
      return res.status(404).json({ error: 'Collection not found' });
    }
    res.json({ collection: { id: updated._id.toString(), name: updated.name } });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ error: 'Collection name already exists' });
    }
    throw error;
  }
});

router.delete('/collections/:collectionId', async (req, res) => {
  const { collectionId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(collectionId)) {
    return res.status(400).json({ error: 'Invalid collectionId' });
  }
  const userObjectId = new mongoose.Types.ObjectId(req.user.id);
  const collection = await VaultCollection.findOne({ _id: collectionId, userId: userObjectId });
  if (!collection) {
    return res.status(404).json({ error: 'Collection not found' });
  }
  await DocumentInsight.updateMany({ userId: userObjectId, collectionId }, { $set: { collectionId: null } });
  await VaultDocumentJob.updateMany({ userId: userObjectId, collectionId }, { $set: { collectionId: null } });
  await VaultCollection.deleteOne({ _id: collectionId, userId: userObjectId });
  res.json({ ok: true });
});

router.get('/collections/:collectionId/archive', async (req, res) => {
  const { collectionId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(collectionId)) {
    return res.status(400).json({ error: 'Invalid collectionId' });
  }
  const userId = req.user.id;
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const collection = await VaultCollection.findOne({ _id: collectionId, userId: userObjectId });
  if (!collection) {
    return res.status(404).json({ error: 'Collection not found' });
  }
  const insights = await DocumentInsight.find({ userId: userObjectId, collectionId: new mongoose.Types.ObjectId(collectionId) }).sort({
    updatedAt: -1,
  });

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (error) => {
    console.error('collection archive error', error);
    res.status(500).end();
  });

  const safeName = `${collection.name || 'collection'}`.replace(/[\\/:*?"<>|]+/g, '_');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(`${safeName || 'collection'}.zip`)}"`);

  archive.pipe(res);

  for (const doc of insights) {
    const key = decodeFileKey(doc.fileId);
    if (!key) continue;
    if (!validateFileOwnership(userId, key)) continue;
    try {
      const object = await getObject(key);
      const entryName = path.basename(key) || `${doc.fileId}.pdf`;
      if (object.Body && typeof object.Body.pipe === 'function') {
        archive.append(object.Body, { name: entryName });
      } else if (object.Body && typeof object.Body.arrayBuffer === 'function') {
        const buffer = Buffer.from(await object.Body.arrayBuffer());
        archive.append(buffer, { name: entryName });
      }
    } catch (error) {
      console.warn('collection archive skip', error);
    }
  }

  await archive.finalize();
});

async function recordUploadSession({ userId, sessionId, files }) {
  if (!sessionId) return null;
  const now = new Date();
  const total = Array.isArray(files) ? files.length : 0;
  const accepted = Array.isArray(files) ? files.filter((file) => !file.error).length : 0;
  const rejected = total - accepted;
  return UploadSession.findOneAndUpdate(
    { userId, sessionId },
    {
      $setOnInsert: { createdAt: now },
      $set: {
        updatedAt: now,
        summary: { total, accepted, rejected },
        files: (files || []).map((file) => ({
          fileId: file.fileId,
          originalName: file.originalName,
          status: file.error ? 'rejected' : 'uploaded',
          reason: file.error || null,
        })),
      },
    },
    { new: true, upsert: true }
  );
}

async function createJobsForUploadedFiles({ userId, sessionId, files, collectionId }) {
  const jobs = [];
  if (!Array.isArray(files)) return jobs;
  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop
    const job = await createJobForFile({ userId, sessionId, file, collectionId });
    jobs.push(job);
    if (job.state === 'queued' || job.state === 'needs_trim') {
      dispatchDocupipe(job);
    }
  }
  return jobs;
}

function shouldTrimForClass(classKey) {
  return typeof classKey === 'string' && classKey.includes('statement');
}

function resolveSchemaIdForClass(classKey) {
  if (!classKey) return null;
  const direct = CLASSIFICATION_SCHEMA_MAP[classKey];
  if (direct) return direct;
  if (classKey.includes('statement')) {
    return process.env.DOCUPIPE_BANK_SCHEMA_ID || null;
  }
  return null;
}

function buildTrimmedKey(pdfKey) {
  if (!pdfKey) return null;
  if (pdfKey.endsWith('.pdf')) {
    return `${pdfKey.slice(0, -4)}.trimmed.pdf`;
  }
  return `${pdfKey}.trimmed.pdf`;
}

async function updateUploadSessionFileStatus({ userId, fileId, status, reason = null }) {
  if (!fileId) return;
  const update = { 'files.$.status': status };
  if (reason) {
    update['files.$.reason'] = reason;
  }
  await UploadSession.updateOne({ userId, 'files.fileId': fileId }, { $set: update });
}

function mapJobStateToSessionStatus(state) {
  switch (state) {
    case 'completed':
      return 'done';
    case 'failed':
      return 'rejected';
    case 'needs_trim':
    case 'awaiting_manual_json':
      return 'processing';
    case 'queued':
    case 'processing':
    default:
      return 'processing';
  }
}

function mapVaultStateToLight(state) {
  switch (state) {
    case 'completed':
      return 'green';
    case 'failed':
    case 'needs_trim':
    case 'awaiting_manual_json':
      return 'red';
    case 'processing':
    case 'queued':
    default:
      return 'amber';
  }
}

function latestErrorMessage(job) {
  if (!job?.errors || job.errors.length === 0) return null;
  const last = job.errors[job.errors.length - 1];
  return last?.message || null;
}

async function createJobForFile({ userId, sessionId, file, collectionId }) {
  const collectionObjectId = collectionId ? new mongoose.Types.ObjectId(collectionId) : null;
  const baseDoc = {
    userId,
    sessionId,
    fileId: file.fileId,
    originalName: file.originalName,
    collectionId: collectionObjectId,
    classification: {},
    storage: {
      pdfKey: file.key,
      size: file.size || null,
      contentHash: file.contentHash || null,
    },
    docupipe: {},
    state: 'queued',
    trim: {},
  };

  try {
    const buffer = await readR2Buffer(file.key);
    const text = await extractPdfText(buffer);
    const classification = classifyDocument({ text, originalName: file.originalName });
    if (!classification?.key) {
      const err = new Error('Unable to classify document');
      err.code = 'VAULT_CLASSIFICATION_FAILED';
      throw err;
    }
    const schemaId = resolveSchemaIdForClass(classification.key);
    if (!schemaId) {
      const err = new Error(`No schema configured for ${classification.key}`);
      err.code = 'DOCUPIPE_SCHEMA_MISSING';
      throw err;
    }

    baseDoc.classification = {
      key: classification.key,
      label: classification.label || classification.key,
      confidence: classification.confidence || null,
      schemaId,
    };
    baseDoc.docupipe = {
      schemaId,
    };

    if (shouldTrimForClass(classification.key)) {
      try {
        const trimResult = await trimBankStatement(buffer, {});
        if (trimResult) {
          const { keptPages, originalPageCount, buffer: trimmedBuffer } = trimResult;
          const trimRequired = Number(originalPageCount || 0) > TRIM_PAGE_THRESHOLD;
          const trimmedKey = trimmedBuffer ? buildTrimmedKey(file.key) : null;
          if (trimmedKey && trimmedBuffer) {
            await putObject({ key: trimmedKey, body: trimmedBuffer, contentType: 'application/pdf' });
            baseDoc.storage.trimmedKey = trimmedKey;
          }
          baseDoc.trim = {
            originalPageCount: originalPageCount || null,
            keptPages: Array.isArray(keptPages) ? keptPages : [],
            required: trimRequired,
          };
          if (trimRequired) {
            baseDoc.state = 'needs_trim';
          }
        }
      } catch (trimError) {
        console.warn('Trim analysis failed', trimError);
      }
    }

    const jobDoc = await VaultDocumentJob.create(baseDoc);
    await updateUploadSessionFileStatus({
      userId,
      fileId: jobDoc.fileId,
      status: mapJobStateToSessionStatus(jobDoc.state),
    });
    return jobDoc;
  } catch (error) {
    const failure = {
      ...baseDoc,
      state: 'failed',
      errors: [
        {
          message: error.message || 'Processing failed',
          code: error.code || 'PROCESSING_FAILED',
          at: new Date(),
        },
      ],
    };
    const jobDoc = await VaultDocumentJob.create(failure);
    await updateUploadSessionFileStatus({
      userId,
      fileId: jobDoc.fileId,
      status: mapJobStateToSessionStatus(jobDoc.state),
      reason: error.message || 'Processing failed',
    });
    return jobDoc;
  }
}

async function resolveUserStoragePrefix(userObjectId, userId) {
  try {
    const user = await User.findById(userObjectId).select('firstName lastName').lean();
    return buildUserPrefix(user, userId);
  } catch (error) {
    console.warn('user prefix fallback', error);
    return buildUserPrefix(null, userId);
  }
}

function buildUserPrefix(user, fallbackId) {
  const parts = [];
  if (user?.firstName) parts.push(String(user.firstName));
  if (user?.lastName) parts.push(String(user.lastName));
  const raw = parts.join(' ').trim();
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (cleaned) return cleaned;
  const fallback = String(fallbackId || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (fallback) return `user-${fallback}`;
  return 'user';
}

module.exports = router;

function normaliseTile(entry) {
  if (!entry) {
    return { count: 0, lastUpdated: null };
  }
  return { count: entry.count, lastUpdated: entry.lastUpdated ? dayjs(entry.lastUpdated).toISOString() : null };
}

function toIsoDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function pickFirstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function mapDocumentForResponse(doc, job = null) {
  if (!doc) return null;
  const metadataRaw = doc.metadata || {};
  const metricsRaw = doc.metrics || {};
  const metadata = typeof metadataRaw?.toObject === 'function' ? metadataRaw.toObject() : metadataRaw;
  const metrics = typeof metricsRaw?.toObject === 'function' ? metricsRaw.toObject() : metricsRaw;
  if (metadata && typeof metadata === 'object' && metadata.accountId && typeof metadata.accountId === 'object') {
    if (typeof metadata.accountId.toString === 'function') {
      metadata.accountId = metadata.accountId.toString();
    }
  }
  const uploadedAt = metadata.uploadedAt || doc.updatedAt || doc.createdAt || null;
  const size = metadata.fileSize || metadata.size || metadata.bytes || metrics.fileSize || metrics.bytes || null;
  const displayName =
    pickFirstString(
      doc.documentName,
      doc.documentLabel,
      metadata.documentName,
      metadata.documentLabel,
      metadata.originalName,
      metadata.fileName
    ) || `Document ${doc.documentMonth || ''}`.trim();

  return {
    id: doc.fileId,
    fileId: doc.fileId,
    name: displayName,
    catalogueKey: doc.catalogueKey,
    documentMonth: doc.documentMonth,
    documentDate: toIsoDate(doc.documentDate || metadata.documentDate),
    documentLabel: doc.documentLabel || metadata.documentLabel || null,
    uploadedAt: toIsoDate(uploadedAt),
    size: typeof size === 'number' ? size : Number(size) || null,
    metrics,
    metadata,
    accountNumberMasked: metadata.accountNumberMasked || null,
    accountId: typeof metadata.accountId === 'string' ? metadata.accountId : null,
    employerName: metadata.employerName || null,
    viewUrl: `/api/vault/files/${encodeURIComponent(doc.fileId)}/view`,
    downloadUrl: `/api/vault/files/${encodeURIComponent(doc.fileId)}/download`,
    upload: 'green',
    processing: mapVaultStateToLight(job?.state || 'completed'),
    state: job?.state || 'completed',
    classification: job?.classification || null,
    message: latestErrorMessage(job),
  };
}
