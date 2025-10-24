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
const { applyDocumentInsights, setInsightsProcessing } = require('../src/services/documents/insightsStore');
const { rebuildMonthlyAnalytics } = require('../src/services/vault/analytics');

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

const MANUAL_SCHEMA_BY_CLASSIFICATION = {
  payslip: 'payslip',
  current_account_statement: 'bank_statement',
  savings_account_statement: 'bank_statement',
  isa_statement: 'bank_statement',
  investment_statement: 'bank_statement',
  pension_statement: 'bank_statement',
};

const SUPPORTED_MANUAL_SCHEMAS = new Set(Object.values(MANUAL_SCHEMA_BY_CLASSIFICATION));

const STATEMENT_CATALOGUE_KEYS = [
  'current_account_statement',
  'savings_account_statement',
  'isa_statement',
];

const FALLBACK_EMPLOYER_NAME = 'Other employer';
const FALLBACK_INSTITUTION_NAME = 'Financial institution';

function encodeBase64Url(value) {
  return Buffer.from(String(value ?? '')).toString('base64url');
}

function decodeBase64Url(value) {
  try {
    return Buffer.from(String(value ?? ''), 'base64url').toString('utf8');
  } catch (error) {
    return '';
  }
}

function coerceTrimmedString(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value).trim();
  if (typeof value === 'object' && typeof value.toString === 'function') {
    const str = value.toString();
    if (str && str !== '[object Object]') {
      return str.trim();
    }
  }
  return '';
}

function normaliseInstitutionLabel(source, fallback = FALLBACK_INSTITUTION_NAME) {
  if (!source) return fallback;
  const candidates = [];
  if (typeof source === 'string') {
    candidates.push(source);
  } else if (typeof source === 'object') {
    const institution = source.institution && typeof source.institution === 'object' ? source.institution : null;
    if (institution) {
      candidates.push(
        institution.name,
        institution.displayName,
        institution.legalName,
        institution.organisation,
        institution.orgName,
        institution.providerName
      );
    }
    candidates.push(
      source.institutionName,
      source.bankName,
      source.providerName,
      source.provider,
      source.organisation,
      source.orgName,
      source.name
    );
  }
  for (const candidate of candidates) {
    const trimmed = coerceTrimmedString(candidate);
    if (trimmed) return trimmed;
  }
  return fallback;
}

function normaliseEmployerLabel(source, fallback = FALLBACK_EMPLOYER_NAME) {
  if (!source) return fallback;
  if (typeof source === 'string') {
    const trimmed = coerceTrimmedString(source);
    return trimmed || fallback;
  }
  if (typeof source !== 'object') return fallback;
  const employer = source.employer && typeof source.employer === 'object' ? source.employer : null;
  const candidates = [];
  if (employer) {
    candidates.push(employer.name, employer.displayName, employer.legalName, employer.organisation, employer.orgName);
  }
  candidates.push(
    source.employerName,
    source.companyName,
    source.company,
    source.organisation,
    source.orgName,
    source.name,
    source.label
  );
  for (const candidate of candidates) {
    const trimmed = coerceTrimmedString(candidate);
    if (trimmed) return trimmed;
  }
  return fallback;
}

function normaliseAccountKey(meta) {
  if (!meta || typeof meta !== 'object') return '';
  const candidates = [
    meta.accountId,
    meta.accountNumberMasked,
    meta.accountNumber,
    meta.iban,
    meta.sortCode,
    meta.accountName,
    meta.account,
  ];
  for (const candidate of candidates) {
    const trimmed = coerceTrimmedString(candidate);
    if (trimmed) return trimmed;
  }
  return '';
}

function normaliseAccountDisplay(meta, fallback = 'Account') {
  if (!meta || typeof meta !== 'object') return fallback;
  const candidates = [meta.accountName, meta.accountNumberMasked, meta.accountNumber, meta.iban];
  for (const candidate of candidates) {
    const trimmed = coerceTrimmedString(candidate);
    if (trimmed) return trimmed;
  }
  return fallback;
}

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

function resolveManualSchemaKey({ job = null, insight = null, requested = null } = {}) {
  const requestedKey = normaliseManualSchemaKey(requested);
  if (requestedKey && SUPPORTED_MANUAL_SCHEMAS.has(requestedKey)) {
    return requestedKey;
  }

  const jobKey = normaliseManualSchemaKey(job?.classification?.key);
  if (jobKey && MANUAL_SCHEMA_BY_CLASSIFICATION[jobKey]) {
    return MANUAL_SCHEMA_BY_CLASSIFICATION[jobKey];
  }

  const jobType = normaliseManualSchemaKey(job?.classification?.type);
  if (jobType && MANUAL_SCHEMA_BY_CLASSIFICATION[jobType]) {
    return MANUAL_SCHEMA_BY_CLASSIFICATION[jobType];
  }

  const insightKey = normaliseManualSchemaKey(insight?.catalogueKey);
  if (insightKey && MANUAL_SCHEMA_BY_CLASSIFICATION[insightKey]) {
    return MANUAL_SCHEMA_BY_CLASSIFICATION[insightKey];
  }

  return null;
}

function normaliseManualSchemaKey(value) {
  if (!value) return null;
  return String(value).trim().toLowerCase();
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

router.get('/json', async (req, res) => {
  const docId = String(req.query?.docId || '').trim();
  if (!docId) {
    return res.status(400).json({ ok: false, error: 'DOC_ID_REQUIRED' });
  }

  const userObjectId = new mongoose.Types.ObjectId(req.user.id);

  try {
    const job = await VaultDocumentJob.findOne({ userId: userObjectId, fileId: docId }).lean();
    let payload = null;
    let meta = null;
    let processing = null;
    let result = null;
    let insight = null;

    if (job) {
      meta = {
        fileId: job.fileId,
        state: job.state,
        classification: job.classification || null,
        errors: Array.isArray(job.errors) ? job.errors : [],
        trim: job.trim || null,
        requiresManualFields: job.requiresManualFields || null,
      };
      processing = {
        documentId: job.docupipe?.documentId || null,
        stdJobId: job.docupipe?.stdJobId || null,
        standardizationId: job.docupipe?.standardizationId || null,
        schemaId: job.docupipe?.schemaId || job.classification?.schemaId || null,
        completedAt: job.completedAt || null,
        requiresManualFields: job.requiresManualFields || null,
      };
      result = {
        json_key: job.storage?.jsonKey || null,
        pdf_key: job.storage?.pdfKey || null,
        trimmed_key: job.storage?.trimmedKey || null,
      };

      const jsonKey = job?.storage?.jsonKey;
      if (jsonKey) {
        try {
          const buffer = await readR2Buffer(jsonKey);
          if (buffer && buffer.length) {
            payload = JSON.parse(buffer.toString('utf8'));
          }
        } catch (error) {
          console.warn('processed json fetch failed', error);
        }
      }
    }

    if (!payload) {
      insight = await DocumentInsight.findOne({ userId: userObjectId, fileId: docId }).lean();
      if (insight) {
        payload = {
          metadata: insight.metadata || {},
          metrics: insight.metrics || {},
          transactions: Array.isArray(insight.transactions) ? insight.transactions : [],
          narrative: Array.isArray(insight.narrative) ? insight.narrative : [],
        };
        if (!meta) {
          meta = {
            fileId: insight.fileId,
            catalogueKey: insight.catalogueKey || null,
            documentDate: insight.documentDate || null,
            documentMonth: insight.documentMonth || null,
          };
        }
      }
    }

    const schemaKey = resolveManualSchemaKey({ job, insight });

    if (!payload) {
      return res.json({ ok: false, error: 'JSON_NOT_READY', schema: schemaKey });
    }

    res.json({ ok: true, json: payload, meta, processing, result, schema: schemaKey });
  } catch (error) {
    console.error('processed json error', error);
    res.status(500).json({ ok: false, error: 'JSON_FETCH_FAILED' });
  }
});

router.put('/json/:docId', express.json({ limit: '1mb' }), async (req, res) => {
  const docId = String(req.params?.docId || '').trim();
  if (!docId) {
    return res.status(400).json({ ok: false, error: 'DOC_ID_REQUIRED' });
  }

  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'UNAUTHORISED' });
  }

  const userObjectId = new mongoose.Types.ObjectId(userId);
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const rawPayload = body?.json ?? body?.payload ?? body;
  if (!rawPayload || typeof rawPayload !== 'object') {
    return res.status(400).json({ ok: false, error: 'INVALID_PAYLOAD' });
  }

  const decodedKey = decodeFileKey(docId);
  if (!decodedKey || !validateFileOwnership(userId, decodedKey)) {
    return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
  }

  let job = null;
  try {
    job = await VaultDocumentJob.findOne({ userId: userObjectId, fileId: docId });
  } catch (error) {
    console.warn('manual json job lookup failed', error);
  }

  const requestedSchema = body?.schema ?? body?.manualSchema ?? body?.type ?? rawPayload?.schema ?? rawPayload?.manualSchema;
  const schemaKey = resolveManualSchemaKey({ job, requested: requestedSchema });
  if (!schemaKey || !SUPPORTED_MANUAL_SCHEMAS.has(schemaKey)) {
    return res.status(400).json({ ok: false, error: 'SCHEMA_UNSUPPORTED' });
  }

  const { payload, errors } = normaliseManualJsonPayload(rawPayload, schemaKey);
  if (errors.length) {
    return res.status(422).json({ ok: false, error: 'VALIDATION_FAILED', details: errors });
  }

  const now = new Date();
  const manualMeta = {
    ...payload.metadata,
    manualOverride: true,
    lastManualUpdateAt: now.toISOString(),
  };
  if (!manualMeta.documentMonth) {
    const periodMonth = resolvePeriodMonth(payload.metrics?.period) || resolvePeriodMonth(payload.metadata?.period);
    if (periodMonth) {
      manualMeta.documentMonth = periodMonth;
    }
  }
  if (!manualMeta.documentMonth) {
    manualMeta.documentMonth = inferDocumentMonth(manualMeta.documentDate);
  }
  payload.metadata = manualMeta;

  const jsonKey = `${decodedKey}.std.json`;
  const buffer = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');

  try {
    await putObject({ key: jsonKey, body: buffer, contentType: 'application/json' });
  } catch (error) {
    console.error('manual json upload failed', error);
    return res.status(500).json({ ok: false, error: 'JSON_PERSIST_FAILED' });
  }

  const classificationKey = pickClassificationKey(job, manualMeta);
  const fileInfo = {
    id: docId,
    name: job?.originalName || manualMeta.documentName || manualMeta.documentLabel || docId,
    uploadedAt: manualMeta.uploadedAt || job?.completedAt || job?.createdAt || null,
    collectionId: job?.collectionId ? job.collectionId.toString() : null,
  };

  try {
    await applyDocumentInsights(userId, classificationKey, {
      storeKey: classificationKey,
      baseKey: classificationKey,
      insightType: classificationKey,
      metadata: manualMeta,
      metrics: payload.metrics,
      transactions: payload.transactions,
      narrative: payload.narrative,
    }, fileInfo);
  } catch (error) {
    console.error('manual json insight apply failed', error);
  }

  if (job) {
    try {
      job.storage = job.storage || {};
      job.storage.jsonKey = jsonKey;
      job.state = 'completed';
      job.requiresManualFields = null;
      job.completedAt = now;
      const audit = Array.isArray(job.audit) ? job.audit.slice() : [];
      audit.push({ state: 'manual_json_saved', at: now, note: 'Manual values supplied via UI' });
      job.audit = audit;
      job.markModified('storage');
      job.markModified('audit');
      job.markModified('requiresManualFields');
      await job.save();
    } catch (error) {
      console.warn('manual json job update failed', error);
    }
  }

  try {
    await setInsightsProcessing(userId, classificationKey, {
      active: false,
      message: 'Manual data saved',
      fileId: docId,
      updatedAt: now,
    });
  } catch (error) {
    console.warn('manual json processing state failed', error);
  }

  try {
    const month = manualMeta.documentMonth || inferDocumentMonth(manualMeta.documentDate);
    if (month) {
      await rebuildMonthlyAnalytics({ userId: userObjectId, month }).catch((err) => {
        console.warn('manual json analytics rebuild failed', err);
      });
    }
  } catch (error) {
    console.warn('manual json analytics scheduling failed', error);
  }

  res.json({ ok: true, json: payload, jsonKey, catalogueKey: classificationKey, schema: schemaKey });
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
  const userObjectId = new mongoose.Types.ObjectId(req.user.id);
  const insights = await DocumentInsight.find({ userId: userObjectId, catalogueKey: 'payslip' })
    .select('metadata documentDate')
    .sort({ documentDate: 1 });

  const grouped = new Map();

  for (const doc of insights) {
    const metadataRaw = doc?.metadata || {};
    const metadata = typeof metadataRaw?.toObject === 'function' ? metadataRaw.toObject() : metadataRaw;
    const employerName = normaliseEmployerLabel(metadata);
    const key = employerName || FALLBACK_EMPLOYER_NAME;
    const entry = grouped.get(key) || {
      employerId: encodeBase64Url(key),
      name: key,
      count: 0,
      lastPayDate: null,
    };
    entry.count += 1;
    const docDate = doc.documentDate instanceof Date ? doc.documentDate : doc.documentDate ? new Date(doc.documentDate) : null;
    if (docDate && (!entry.lastPayDate || docDate > entry.lastPayDate)) {
      entry.lastPayDate = docDate;
    }
    grouped.set(key, entry);
  }

  const employers = Array.from(grouped.values()).sort((a, b) => a.name.localeCompare(b.name));

  res.json({ employers });
});

router.get('/payslips/employers/:employerId/files', async (req, res) => {
  const employerName = decodeBase64Url(req.params.employerId) || FALLBACK_EMPLOYER_NAME;
  const userObjectId = new mongoose.Types.ObjectId(req.user.id);
  const targetName = coerceTrimmedString(employerName) || FALLBACK_EMPLOYER_NAME;

  const documents = await DocumentInsight.find({ userId: userObjectId, catalogueKey: 'payslip' }).sort({ documentDate: -1 });
  const filtered = documents.filter((doc) => {
    const metadataRaw = doc?.metadata || {};
    const metadata = typeof metadataRaw?.toObject === 'function' ? metadataRaw.toObject() : metadataRaw;
    const label = normaliseEmployerLabel(metadata);
    return (label || FALLBACK_EMPLOYER_NAME) === targetName;
  });

  res.json({
    employer: targetName,
    files: filtered.map((doc) => ({
      ...mapDocumentForResponse(doc),
      status: doc.narrative?.length ? 'processed' : 'pending',
    })),
  });
});

router.get('/statements/institutions', async (req, res) => {
  const userObjectId = new mongoose.Types.ObjectId(req.user.id);
  const accounts = await Account.find({ userId: userObjectId }).sort({ institutionName: 1, displayName: 1 });
  const insights = await DocumentInsight.find({
    userId: userObjectId,
    catalogueKey: { $in: STATEMENT_CATALOGUE_KEYS },
  }).select('metadata documentDate');

  const grouped = new Map();

  for (const doc of insights) {
    const metadataRaw = doc?.metadata || {};
    const metadata = typeof metadataRaw?.toObject === 'function' ? metadataRaw.toObject() : metadataRaw;
    const institutionName = normaliseInstitutionLabel(metadata);
    const key = institutionName;
    const entry = grouped.get(key) || {
      institutionId: encodeBase64Url(key),
      name: key,
      accountKeys: new Set(),
      docCount: 0,
      lastDocumentDate: null,
    };
    const accountKey = normaliseAccountKey(metadata);
    if (accountKey) {
      entry.accountKeys.add(accountKey);
    }
    entry.docCount += 1;
    const docDate = doc.documentDate instanceof Date ? doc.documentDate : doc.documentDate ? new Date(doc.documentDate) : null;
    if (docDate && (!entry.lastDocumentDate || docDate > entry.lastDocumentDate)) {
      entry.lastDocumentDate = docDate;
    }
    grouped.set(key, entry);
  }

  for (const account of accounts) {
    const institutionName = normaliseInstitutionLabel({ institutionName: account.institutionName });
    const key = institutionName;
    const entry = grouped.get(key) || {
      institutionId: encodeBase64Url(key),
      name: key,
      accountKeys: new Set(),
      docCount: 0,
      lastDocumentDate: null,
    };
    entry.accountKeys.add(account._id.toString());
    grouped.set(key, entry);
  }

  const institutions = Array.from(grouped.values())
    .map((entry) => ({
      institutionId: entry.institutionId,
      name: entry.name,
      accounts: entry.accountKeys.size || (entry.docCount > 0 ? 1 : 0),
      documents: entry.docCount,
      lastStatementDate: entry.lastDocumentDate,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  res.json({ institutions });
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
  const institutionName = decodeBase64Url(req.params.institutionId) || FALLBACK_INSTITUTION_NAME;
  const userObjectId = new mongoose.Types.ObjectId(req.user.id);

  const allAccounts = await Account.find({ userId: userObjectId }).sort({ displayName: 1 });
  const matchingAccounts = allAccounts.filter(
    (account) => normaliseInstitutionLabel({ institutionName: account.institutionName }) === institutionName
  );

  const documents = await DocumentInsight.find({
    userId: userObjectId,
    catalogueKey: { $in: STATEMENT_CATALOGUE_KEYS },
  }).sort({ documentMonth: -1, documentDate: -1, updatedAt: -1 });
  const matchingDocuments = documents.filter((doc) => {
    const metadataRaw = doc?.metadata || {};
    const metadata = typeof metadataRaw?.toObject === 'function' ? metadataRaw.toObject() : metadataRaw;
    return normaliseInstitutionLabel(metadata) === institutionName;
  });

  const jobs = await VaultDocumentJob.find({
    userId: userObjectId,
    fileId: { $in: matchingDocuments.map((doc) => doc.fileId) },
  }).select('fileId state errors classification');
  const jobMap = new Map(jobs.map((job) => [job.fileId, job]));

  const accountsById = new Map();
  const maskedLookup = new Map();
  for (const account of matchingAccounts) {
    const accountId = account._id.toString();
    accountsById.set(accountId, {
      accountId,
      displayName: account.displayName,
      accountType: account.accountType,
      accountNumberMasked: account.accountNumberMasked,
      files: [],
    });
    const masked = coerceTrimmedString(account.accountNumberMasked);
    if (masked) {
      maskedLookup.set(masked, accountId);
    }
  }

  const fallbackAccounts = new Map();

  function getFallbackAccount(metadata) {
    const accountKey = normaliseAccountKey(metadata) || metadata?.accountType || 'uncategorized';
    const fallbackId = encodeBase64Url(`${institutionName}::${accountKey}`);
    if (!fallbackAccounts.has(fallbackId)) {
      fallbackAccounts.set(fallbackId, {
        accountId: fallbackId,
        displayName: normaliseAccountDisplay(metadata, 'Other account'),
        accountType: metadata?.accountType || null,
        accountNumberMasked: metadata?.accountNumberMasked || null,
        files: [],
      });
    }
    return fallbackAccounts.get(fallbackId);
  }

  for (const doc of matchingDocuments) {
    const metadataRaw = doc?.metadata || {};
    const metadata = typeof metadataRaw?.toObject === 'function' ? metadataRaw.toObject() : metadataRaw;
    let accountEntry = null;

    const metaAccountId = coerceTrimmedString(metadata.accountId);
    if (metaAccountId && accountsById.has(metaAccountId)) {
      accountEntry = accountsById.get(metaAccountId);
    }

    if (!accountEntry) {
      const masked = coerceTrimmedString(metadata.accountNumberMasked);
      if (masked && maskedLookup.has(masked)) {
        const matchedId = maskedLookup.get(masked);
        accountEntry = accountsById.get(matchedId) || null;
      }
    }

    if (!accountEntry && metaAccountId) {
      const fallbackId = encodeBase64Url(`${institutionName}::${metaAccountId}`);
      if (!fallbackAccounts.has(fallbackId)) {
        fallbackAccounts.set(fallbackId, {
          accountId: fallbackId,
          displayName: normaliseAccountDisplay(metadata, 'Other account'),
          accountType: metadata?.accountType || null,
          accountNumberMasked: metadata?.accountNumberMasked || null,
          files: [],
        });
      }
      accountEntry = fallbackAccounts.get(fallbackId);
    }

    if (!accountEntry) {
      accountEntry = getFallbackAccount(metadata);
    }

    const payload = mapDocumentForResponse(doc, jobMap.get(doc.fileId));
    if (!payload) continue;

    if (accountEntry.accountId && !payload.accountId) {
      payload.accountId = accountEntry.accountId;
    }
    if (accountEntry.accountNumberMasked && !payload.accountNumberMasked) {
      payload.accountNumberMasked = accountEntry.accountNumberMasked;
    }
    if (!payload.metadata) payload.metadata = {};
    if (payload.metadata && typeof payload.metadata === 'object') {
      if (!payload.metadata.accountId) {
        payload.metadata.accountId = payload.accountId || accountEntry.accountId || null;
      }
      if (accountEntry.accountNumberMasked && !payload.metadata.accountNumberMasked) {
        payload.metadata.accountNumberMasked = accountEntry.accountNumberMasked;
      }
      if (accountEntry.accountType && !payload.metadata.accountType) {
        payload.metadata.accountType = accountEntry.accountType;
      }
    }
    accountEntry.files.push(payload);
  }

  const accounts = [...accountsById.values(), ...fallbackAccounts.values()]
    .filter((account) => Array.isArray(account.files) && account.files.length > 0)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  res.json({
    institution: { name: institutionName, accountCount: accounts.length },
    accounts,
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

const AMOUNT_FIELD_PATTERN = /(amount|balance|total|value|gross|net|salary|income|pay|payment|contribution|tax|deduction|ni|loan|fee|limit)$/i;
const DATE_FIELD_PATTERN = /(date|month|period|issued|start|end)$/i;

function normaliseManualJsonPayload(input) {
  const errors = [];
  const base = input && typeof input === 'object' ? input : {};
  const metadata = normaliseValueTree(['metadata'], ensurePlainManualObject(base.metadata), errors);
  const metrics = normaliseValueTree(['metrics'], ensurePlainManualObject(base.metrics), errors);
  const transactions = normaliseTransactions(Array.isArray(base.transactions) ? base.transactions : [], errors);
  const narrative = Array.isArray(base.narrative)
    ? base.narrative.map((item, index) => {
        if (item == null) return null;
        const text = String(item).trim();
        if (!text) return null;
        if (text.length > 2000) {
          errors.push({ path: formatPath(['narrative', index]), message: 'Narrative entries must be under 2000 characters.' });
          return null;
        }
        return text;
      }).filter(Boolean)
    : [];

  return {
    payload: {
      metadata,
      metrics,
      transactions,
      narrative,
    },
    errors,
  };
}

function ensurePlainManualObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function normaliseTransactions(entries, errors) {
  const list = [];
  entries.forEach((entry, index) => {
    const tx = normaliseValueTree(['transactions', index], ensurePlainManualObject(entry), errors);
    if (Object.keys(tx).length) {
      list.push(tx);
    }
  });
  return list;
}

function normaliseValueTree(path, source, errors) {
  const result = {};
  Object.entries(source || {}).forEach(([rawKey, rawValue]) => {
    const key = String(rawKey || '').trim();
    if (!key) return;
    const nextPath = [...path, key];
    const processed = normaliseValue(nextPath, rawValue, errors);
    if (processed.keep) {
      result[key] = processed.value;
    }
  });
  return result;
}

function normaliseValue(path, value, errors) {
  if (value == null || value === '') {
    return { keep: false };
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      errors.push({ path: formatPath(path), message: 'Enter a valid number.' });
      return { keep: false };
    }
    return { keep: true, value };
  }
  if (typeof value === 'boolean') {
    return { keep: true, value };
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) {
      return { keep: false };
    }
    if (text.length > 500) {
      errors.push({ path: formatPath(path), message: 'Value is too long (max 500 characters).' });
      return { keep: false };
    }
    if (shouldTreatAsAmount(path)) {
      const number = parseAmount(text);
      if (!Number.isFinite(number)) {
        errors.push({ path: formatPath(path), message: 'Enter a valid monetary amount.' });
        return { keep: false };
      }
      return { keep: true, value: number };
    }
    if (shouldTreatAsDate(path)) {
      const iso = normaliseDate(text);
      if (!iso) {
        errors.push({ path: formatPath(path), message: 'Enter a valid date.' });
        return { keep: false };
      }
      return { keep: true, value: iso };
    }
    return { keep: true, value: text };
  }
  if (Array.isArray(value)) {
    const items = [];
    value.forEach((item, index) => {
      const processed = normaliseValue([...path, index], item, errors);
      if (processed.keep) {
        items.push(processed.value);
      }
    });
    return { keep: items.length > 0, value: items };
  }
  if (typeof value === 'object') {
    const nested = normaliseValueTree(path, ensurePlainManualObject(value), errors);
    return { keep: Object.keys(nested).length > 0, value: nested };
  }
  return { keep: false };
}

function shouldTreatAsAmount(path) {
  const key = String(path[path.length - 1] || '');
  return AMOUNT_FIELD_PATTERN.test(key);
}

function shouldTreatAsDate(path) {
  const key = String(path[path.length - 1] || '');
  return DATE_FIELD_PATTERN.test(key);
}

function parseAmount(text) {
  const cleaned = text.replace(/[^0-9+\-.]/g, '');
  if (!cleaned) return Number.NaN;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : Number.NaN;
}

function normaliseDate(text) {
  if (!text && text !== 0) return null;
  const value = String(text).trim();
  if (!value) return null;
  if (/^\d{2}\/\d{4}$/.test(value)) {
    const [month, year] = value.split('/');
    return `${month.padStart(2, '0')}/${year.padStart(4, '0')}`;
  }
  if (/^\d{4}-\d{2}$/.test(value)) {
    return value;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  if (/^\d{4}-\d{2}-\d{2}t/i.test(value)) {
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return null;
    return new Date(parsed).toISOString();
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;
  const date = new Date(timestamp);
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = String(date.getUTCFullYear());
  return `${month}/${year}`;
}

function formatPath(parts) {
  return parts.reduce((acc, part) => {
    const token = typeof part === 'number' ? `[${part}]` : String(part);
    if (!acc) return token;
    if (token.startsWith('[')) return `${acc}${token}`;
    return `${acc}.${token}`;
  }, '');
}

function pickClassificationKey(job, meta) {
  if (job?.classification?.key) return job.classification.key;
  if (typeof meta?.catalogueKey === 'string' && meta.catalogueKey.trim()) {
    return meta.catalogueKey.trim();
  }
  if (typeof meta?.docType === 'string' && meta.docType.trim()) {
    return meta.docType.trim();
  }
  return 'manual_document';
}

function inferDocumentMonth(documentDate) {
  if (!documentDate) return null;
  if (typeof documentDate === 'string' && /^\d{4}-\d{2}$/.test(documentDate)) {
    return documentDate;
  }
  const date = new Date(documentDate);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

function resolvePeriodMonth(period) {
  if (!period || typeof period !== 'object') return null;
  const monthCandidate = period.month || period.monthKey;
  if (typeof monthCandidate === 'string' && /^\d{4}-\d{2}$/.test(monthCandidate.trim())) {
    return monthCandidate.trim();
  }
  const start = period.start || period.from;
  if (start) {
    return inferDocumentMonth(start);
  }
  return null;
}
