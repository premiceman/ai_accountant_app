const express = require('express');
const multer = require('multer');
const dayjs = require('dayjs');
const { randomUUID } = require('crypto');
const UploadedDocument = require('../models/UploadedDocument');
const DocumentResult = require('../models/DocumentResult');
const { mongoose } = require('../models');
const { config } = require('../config');
const {
  postDocumentWithWorkflow,
  extractStandardizationCandidates,
  pollJobResilient,
  getStandardizationWithRetry,
  getDocupipeRequestConfig,
} = require('../services/docupipe');
const { writeBuffer, deleteObject, createPresignedGet } = require('../services/r2');
const { badRequest, notFound } = require('../utils/errors');
const { sha256 } = require('../utils/hashing');
const { resolveDocTypeFromSchema } = require('../utils/docType');
const { createLogger } = require('../utils/logger');

const router = express.Router();

const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_MB || 20) * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

const logger = createLogger('dashboard:documents');

function unwrapPrimitive(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || value instanceof Date) return value;
  if (Array.isArray(value)) return value;
  if (value.normalizedValue !== undefined && value.normalizedValue !== null) return value.normalizedValue;
  if (value.normalisedValue !== undefined && value.normalisedValue !== null) return value.normalisedValue;
  if (value.value !== undefined && value.value !== null) return value.value;
  if (value.rawValue !== undefined && value.rawValue !== null) return value.rawValue;
  return value;
}

function stringField(value) {
  const unwrapped = unwrapPrimitive(value);
  if (unwrapped && typeof unwrapped === 'object' && !Array.isArray(unwrapped)) {
    if (unwrapped.name !== undefined) return stringField(unwrapped.name);
    if (unwrapped.label !== undefined) return stringField(unwrapped.label);
    return null;
  }
  if (unwrapped === null || unwrapped === undefined) return null;
  const str = String(unwrapped).trim();
  return str.length ? str : null;
}

function numericField(value) {
  const unwrapped = unwrapPrimitive(value);
  if (unwrapped === null || unwrapped === undefined) return null;
  if (typeof unwrapped === 'number') {
    return Number.isFinite(unwrapped) ? unwrapped : null;
  }
  if (typeof unwrapped === 'string') {
    const cleaned = unwrapped.replace(/[,£$]/g, '');
    const num = Number.parseFloat(cleaned);
    return Number.isFinite(num) ? num : null;
  }
  if (typeof unwrapped === 'boolean') {
    return unwrapped ? 1 : 0;
  }
  return null;
}

function normaliseDate(value) {
  const candidate = stringField(value);
  if (!candidate) return null;
  const trimmed = candidate.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
    const [day, month, year] = trimmed.split('/');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  if (/^\d{2}-\d{2}-\d{4}$/.test(trimmed)) {
    const [day, month, year] = trimmed.split('-');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  const parsed = dayjs(trimmed);
  if (parsed.isValid()) {
    return parsed.format('YYYY-MM-DD');
  }
  return null;
}

function deriveMonth(dateValue) {
  if (!dateValue) return null;
  const parsed = dayjs(dateValue);
  if (!parsed.isValid()) return null;
  return parsed.format('YYYY-MM');
}

function extractDocumentPayload(result) {
  if (!result) return null;
  const data = result.data || result.output || result;
  if (Array.isArray(data?.documents) && data.documents.length) {
    return data.documents[0].standardized || data.documents[0].payload || data.documents[0];
  }
  if (data?.document) {
    return data.document.standardized || data.document.payload || data.document;
  }
  return data.standardized || data.payload || data;
}

function extractStandardizationMetadata(stdJson) {
  if (!stdJson || typeof stdJson !== 'object') {
    return {
      schemaId: null,
      schemaName: null,
      standardizationId: null,
      documentId: null,
      status: null,
    };
  }

  const schemaId = firstStringCandidate(
    stdJson.schemaId,
    stdJson.schema_id,
    stdJson.data?.schemaId,
    stdJson.data?.schema_id,
    stdJson.meta?.schemaId,
    stdJson.meta?.schema_id,
    stdJson.document?.schemaId,
    stdJson.document?.schema_id
  );
  const schemaName = firstStringCandidate(
    stdJson.schemaName,
    stdJson.schema_name,
    stdJson.data?.schemaName,
    stdJson.data?.schema_name,
    stdJson.meta?.schemaName,
    stdJson.meta?.schema_name,
    stdJson.document?.schemaName,
    stdJson.document?.schema_name
  );
  const standardizationId = firstStringCandidate(
    stdJson.standardizationId,
    stdJson.standardisationId,
    stdJson.id,
    stdJson.data?.standardizationId,
    stdJson.data?.standardisationId,
    stdJson.data?.id,
    stdJson.document?.standardizationId,
    stdJson.document?.standardisationId,
    stdJson.document?.id
  );
  const documentId = firstStringCandidate(
    stdJson.documentId,
    stdJson.data?.documentId,
    stdJson.meta?.documentId,
    stdJson.document?.documentId,
    stdJson.document?.id,
    standardizationId
  );
  const status = firstStringCandidate(
    stdJson.status,
    stdJson.data?.status,
    stdJson.meta?.status
  );

  return {
    schemaId: schemaId || null,
    schemaName: schemaName || null,
    standardizationId: standardizationId || null,
    documentId: documentId || null,
    status: status || null,
  };
}

function normaliseDocTypeHint(value) {
  const hint = stringField(value);
  if (!hint) return null;
  const lower = hint.toLowerCase();
  if (/(payslip|pay slip|payroll|salary|earnings)/.test(lower)) return 'payslip';
  if (/(statement|bank|transaction|account)/.test(lower)) return 'statement';
  return null;
}

function firstStringCandidate(...values) {
  for (const value of values) {
    const candidate = stringField(value);
    if (candidate) {
      return candidate;
    }
  }
  return null;
}

function extractDocupipeSummary(result) {
  const docupipe = (result && result.docupipe) || {};
  const source = result?.data ?? result?.output ?? result ?? {};

  const classification = firstStringCandidate(
    docupipe.classification,
    source.classification?.name,
    source.classification?.label,
    source.classification?.key,
    source.classification,
    source.catalogue?.name,
    source.catalogue?.label,
    source.catalogue?.key
  );

  const documentType = firstStringCandidate(
    docupipe.documentType,
    source.documentType,
    source.type,
    source.docType,
    source.schema,
    source.schemaName
  );

  const schema = firstStringCandidate(docupipe.schema, source.schema, source.schemaName, source.schema_id);
  const catalogueKey = firstStringCandidate(docupipe.catalogueKey, source.catalogue?.key, source.catalogue?.id);
  const standardizationId = firstStringCandidate(
    docupipe.standardizationId,
    source.standardizationId,
    source.standardisationId,
    docupipe.documentId,
    source.documentId,
    source.id
  );
  const uploadJobId = firstStringCandidate(
    docupipe.standardizationJobId,
    docupipe.uploadJobId,
    docupipe.jobId
  );

  return {
    documentId: standardizationId || null,
    jobId: uploadJobId || null,
    uploadJobId: firstStringCandidate(docupipe.uploadJobId, docupipe.jobId),
    standardizationJobId: firstStringCandidate(docupipe.standardizationJobId),
    standardizationId,
    classification: classification || null,
    documentType: documentType || null,
    schema: schema || null,
    catalogueKey: catalogueKey || null,
    status: docupipe.status || null,
  };
}

function detectDocType(result, { payload, typeHint, docupipe } = {}) {
  const source = result?.data ?? result?.output ?? result;
  const doc = source?.documents?.[0] || source?.document || source;

  const docupipeInfo = docupipe || extractDocupipeSummary(result);

  const fromDocupipe =
    normaliseDocTypeHint(docupipeInfo.classification)
    || normaliseDocTypeHint(docupipeInfo.documentType)
    || normaliseDocTypeHint(docupipeInfo.schema)
    || normaliseDocTypeHint(docupipeInfo.catalogueKey);
  if (fromDocupipe) return fromDocupipe;

  const fromDoc =
    normaliseDocTypeHint(doc?.documentType)
    || normaliseDocTypeHint(doc?.type)
    || normaliseDocTypeHint(doc?.category)
    || normaliseDocTypeHint(doc?.docType)
    || normaliseDocTypeHint(doc?.labels?.primary);
  if (fromDoc) return fromDoc;

  const fromHint = normaliseDocTypeHint(typeHint);
  if (fromHint) return fromHint;

  const candidate = payload || extractDocumentPayload(result);
  if (!candidate || typeof candidate !== 'object') return null;

  const fromPayload =
    normaliseDocTypeHint(candidate.documentType)
    || normaliseDocTypeHint(candidate.type)
    || normaliseDocTypeHint(candidate.category)
    || normaliseDocTypeHint(candidate.docType);
  if (fromPayload) return fromPayload;

  if (Array.isArray(candidate.transactions) && candidate.transactions.length) return 'statement';
  if (Array.isArray(candidate.activity) && candidate.activity.length) return 'statement';

  if (
    candidate.gross
    || candidate.net
    || candidate.payDate
    || candidate.payPeriod
    || candidate.period
    || candidate.employee
    || candidate.employer
    || candidate.deductions
    || candidate.incomeTax
    || candidate.nationalInsurance
  ) {
    return 'payslip';
  }

  const analytics = candidate.analytics || candidate.summary;
  if (analytics && (analytics.net || analytics.gross || analytics.takeHomeRatio)) {
    return 'payslip';
  }

  return null;
}

function normaliseDocupipeStatus(status, { hasStandardizationJob } = {}) {
  if (!status) {
    return hasStandardizationJob ? 'running' : 'completed';
  }
  const lower = String(status).toLowerCase();
  if (['completed', 'complete', 'succeeded', 'success'].includes(lower)) return 'completed';
  if (['failed', 'error'].includes(lower)) return 'failed';
  if (['running', 'processing', 'in_progress'].includes(lower)) return 'running';
  if (['queued', 'pending'].includes(lower)) return 'queued';
  return hasStandardizationJob ? 'running' : 'completed';
}

function formatDocupipe(doc) {
  const info = doc?.docupipe || {};
  const jobId = info.standardizationJobId || info.uploadJobId || info.jobId || null;
  const documentId = info.standardizationId || info.documentId || null;
  return {
    documentResultId: info.documentResultId || null,
    documentId,
    jobId,
    uploadJobId: info.uploadJobId || null,
    standardizationJobId: info.standardizationJobId || null,
    standardizationId: info.standardizationId || null,
    documentType: info.documentType || null,
    classification: info.classification || null,
    schema: info.schema || info.schemaName || null,
    schemaId: info.schemaId || null,
    schemaName: info.schemaName || info.schema || null,
    catalogueKey: info.catalogueKey || null,
    status: info.status || null,
  };
}

function safeRound(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 100) / 100;
}

function parsePayslip(payload) {
  const payDate = normaliseDate(payload.payDate);
  const periodStart = normaliseDate(payload.period?.start);
  const periodEnd = normaliseDate(payload.period?.end);
  const month = deriveMonth(payDate || periodEnd || periodStart);
  if (!month) {
    throw badRequest('Unable to determine payslip month');
  }

  const gross = numericField(payload.gross);
  const net = numericField(payload.net);
  const incomeTax = numericField(payload.incomeTax);
  const nationalInsurance = numericField(payload.nationalInsurance);
  const pension = numericField(payload.pension);
  const studentLoan = numericField(payload.studentLoan);
  const otherDeductions = numericField(payload.otherDeductions?.total) || 0;
  const grossYtd = numericField(payload.grossYTD);
  const taxYtd = numericField(payload.taxYTD);
  const niYtd = numericField(payload.niYTD);
  const pensionYtd = numericField(payload.pensionYTD);

  const totalDeductions = [incomeTax, nationalInsurance, pension, studentLoan, otherDeductions]
    .filter((value) => Number.isFinite(value))
    .reduce((acc, value) => acc + value, 0);

  return {
    docType: 'payslip',
    month,
    payDate,
    periodStart,
    periodEnd,
    metadata: {
      employerName: stringField(payload.employer?.name) || 'Employer',
      employeeTaxCode: stringField(payload.employee?.taxCode),
      employeeNiNumber: stringField(payload.employee?.niNumber),
      currency: stringField(payload.currency) || 'GBP',
    },
    analytics: {
      gross: safeRound(gross),
      net: safeRound(net),
      incomeTax: safeRound(incomeTax),
      nationalInsurance: safeRound(nationalInsurance),
      pension: safeRound(pension),
      studentLoan: safeRound(studentLoan),
      otherDeductions: safeRound(otherDeductions),
      totalDeductions: safeRound(totalDeductions),
      takeHomeRatio: gross ? safeRound(net / gross) : null,
      grossYtd: safeRound(grossYtd),
      taxYtd: safeRound(taxYtd),
      niYtd: safeRound(niYtd),
      pensionYtd: safeRound(pensionYtd),
    },
  };
}

function parseStatement(payload) {
  const periodStart = normaliseDate(payload.period?.start || payload.startDate);
  const periodEnd = normaliseDate(payload.period?.end || payload.endDate);
  const month = deriveMonth(periodStart || periodEnd);
  if (!month) {
    throw badRequest('Unable to determine statement month');
  }

  const openingBalance = numericField(payload.openingBalance);
  const closingBalance = numericField(payload.closingBalance);
  const currency = stringField(payload.currency) || stringField(payload.period?.currency) || 'GBP';

  const transactions = Array.isArray(payload.transactions) ? payload.transactions : [];
  const mappedTransactions = transactions.map((tx) => {
    const date = normaliseDate(tx.date);
    const description = stringField(tx.description) || stringField(tx.narrative) || 'Transaction';
    let amount = numericField(tx.amount);
    const credit = numericField(tx.credit);
    const debit = numericField(tx.debit);
    if (!Number.isFinite(amount)) {
      amount = (Number.isFinite(credit) ? credit : 0) - (Number.isFinite(debit) ? debit : 0);
    }
    const direction = amount >= 0 ? 'credit' : 'debit';
    return {
      date,
      description,
      amount: safeRound(amount),
      credit: safeRound(credit),
      debit: safeRound(debit),
      direction,
    };
  });

  const totalIncome = mappedTransactions
    .filter((tx) => Number.isFinite(tx.amount) && tx.amount > 0)
    .reduce((acc, tx) => acc + tx.amount, 0);
  const totalSpend = mappedTransactions
    .filter((tx) => Number.isFinite(tx.amount) && tx.amount < 0)
    .reduce((acc, tx) => acc + Math.abs(tx.amount), 0);

  return {
    docType: 'statement',
    month,
    periodStart,
    periodEnd,
    metadata: {
      accountNumber: stringField(payload.account?.accountNumber) || stringField(payload.account?.id),
      accountName: stringField(payload.account?.name) || 'Account',
      institutionName: stringField(payload.institution?.name),
      currency,
      openingBalance: safeRound(openingBalance),
      closingBalance: safeRound(closingBalance),
    },
    analytics: {
      totals: {
        income: safeRound(totalIncome),
        spend: safeRound(totalSpend),
        net: safeRound(totalIncome - totalSpend),
      },
    },
    transactions: mappedTransactions,
  };
}

function buildDashboardKey({ userId, fileId, originalName }) {
  const safeName = (originalName || 'document.pdf').replace(/[^a-zA-Z0-9._-]+/g, '_');
  const timestamp = dayjs().format('YYYY/MM/DD');
  return `users/${userId}/dashboard/${timestamp}/${fileId}/${safeName}`;
}

function buildDocumentResultFileUrl(key) {
  if (!key) return null;
  if (config.r2?.publicHost) {
    const base = config.r2.publicHost.replace(/\/$/, '');
    return `${base}/${key}`;
  }
  if (config.r2?.bucket) {
    return `s3://${config.r2.bucket}/${key}`;
  }
  return key;
}

function formatPayslipResponse(doc) {
  return {
    fileId: doc.fileId,
    month: doc.month,
    docType: doc.docType,
    payDate: doc.payDate,
    periodStart: doc.periodStart,
    periodEnd: doc.periodEnd,
    employerName: doc.metadata?.employerName || 'Employer',
    currency: doc.metadata?.currency || 'GBP',
    metrics: doc.analytics,
    docupipe: formatDocupipe(doc),
    createdAt: doc.createdAt,
  };
}

function formatStatementResponse(doc) {
  const topTransactions = (doc.transactions || [])
    .filter((tx) => tx?.amount !== null && tx?.amount !== undefined)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, 5);
  return {
    fileId: doc.fileId,
    month: doc.month,
    docType: doc.docType,
    periodStart: doc.periodStart,
    periodEnd: doc.periodEnd,
    accountName: doc.metadata?.accountName || 'Account',
    accountNumber: doc.metadata?.accountNumber || null,
    institutionName: doc.metadata?.institutionName || null,
    currency: doc.metadata?.currency || 'GBP',
    balances: {
      opening: doc.metadata?.openingBalance ?? null,
      closing: doc.metadata?.closingBalance ?? null,
    },
    totals: doc.analytics?.totals || { income: null, spend: null, net: null },
    topTransactions,
    docupipe: formatDocupipe(doc),
    createdAt: doc.createdAt,
  };
}

function buildMonthSummary(payslips, statements) {
  const currency = payslips[0]?.currency || statements[0]?.currency || 'GBP';
  const totalNetPay = payslips.reduce((acc, slip) => acc + (slip.metrics?.net || 0), 0);
  const totalGrossPay = payslips.reduce((acc, slip) => acc + (slip.metrics?.gross || 0), 0);
  const totalIncome = statements.reduce((acc, st) => acc + (st.totals?.income || 0), 0);
  const totalSpend = statements.reduce((acc, st) => acc + (st.totals?.spend || 0), 0);
  const netCashflow = totalIncome - totalSpend + totalNetPay;
  return {
    currency,
    totals: {
      netPay: safeRound(totalNetPay),
      grossPay: safeRound(totalGrossPay),
      income: safeRound(totalIncome),
      spend: safeRound(totalSpend),
      netCashflow: safeRound(netCashflow),
    },
  };
}

router.post('/documents', upload.single('document'), async (req, res, next) => {
  const userId = req.user.id;
  if (!req.file) {
    return next(badRequest('Please attach a document file'));
  }

  const { buffer, originalname, mimetype, size } = req.file;
  if (!/pdf$/i.test(originalname) && mimetype !== 'application/pdf') {
    return next(badRequest('Only PDF documents are supported in this preview'));
  }

  const contentHash = sha256(buffer);
  let r2Key;
  try {
    const duplicate = await UploadedDocument.findOne({ userId, contentHash }).lean();
    if (duplicate) {
      const docResultId = duplicate.docupipe?.documentResultId || duplicate.raw?.documentResultId || null;
      let docResult = null;
      if (docResultId) {
        const query = { _id: docResultId };
        if (mongoose.Types.ObjectId.isValid(userId)) {
          query.userId = new mongoose.Types.ObjectId(userId);
        }
        docResult = await DocumentResult.findOne(query).lean();
      }

      const type = docResult?.type || duplicate.docType || 'unknown';
      const standardizationId =
        docResult?.standardizationId
        || duplicate.docupipe?.standardizationId
        || duplicate.docupipe?.documentId
        || duplicate.raw?.standardizationId
        || null;
      const documentId =
        docResult?.documentId
        || duplicate.docupipe?.documentId
        || duplicate.docupipe?.standardizationId
        || duplicate.raw?.documentId
        || null;
      const schemaId =
        docResult?.schemaId
        || duplicate.docupipe?.schemaId
        || duplicate.raw?.schemaId
        || null;
      const schemaName =
        docResult?.schemaName
        || duplicate.docupipe?.schemaName
        || duplicate.docupipe?.schema
        || duplicate.raw?.schemaName
        || null;

      return res.status(200).json({
        status: 'duplicate',
        id: docResult ? String(docResult._id) : null,
        type,
        standardizationId,
        documentId,
        schemaId,
        schemaName,
        message: 'This document was already processed.',
      });
    }

    if (!config.docupipe?.workflowId) {
      throw badRequest('DocuPipe workflow is not configured');
    }

    const fileId = randomUUID();
    r2Key = buildDashboardKey({ userId, fileId, originalName: originalname });
    await writeBuffer(r2Key, buffer, mimetype || 'application/pdf');
    const presignedUrl = await createPresignedGet({ key: r2Key, expiresIn: 60 * 15 });

    let submission;
    try {
      submission = await postDocumentWithWorkflow({ fileUrl: presignedUrl, filename: originalname });
    } catch (error) {
      await deleteObject(r2Key).catch(() => {});
      throw error;
    }

    const { initial, uploadJobId } = submission;
    console.log('[docupipe] submitted', {
      uploadJobId: initial?.jobId || null,
      workflowId: initial?.workflowResponse?.workflowId || null,
      steps: Object.keys(initial?.workflowResponse || {}),
    });

    const candidateList = Array.isArray(submission.candidates)
      ? submission.candidates
      : extractStandardizationCandidates(initial);

    const candidates = Array.isArray(candidateList)
      ? candidateList.filter((candidate) => candidate?.standardizationId)
      : [];

    console.log(
      '[docupipe] candidates',
      candidates.map((c) => ({
        src: c.source || null,
        job: c.standardizationJobId || null,
        id: c.standardizationId || null,
      }))
    );

    if (!candidates.length) {
      await deleteObject(r2Key).catch(() => {});
      logger.error('DocuPipe did not return standardization ids', { response: initial });
      const stdError = new Error('DocuPipe did not return standardization ids');
      stdError.status = 502;
      throw stdError;
    }

    const { headers, baseUrl } = getDocupipeRequestConfig();
    let selectedCandidate = null;
    let selectedStdJson = null;
    let selectedJobResult = null;

    for (const candidate of candidates) {
      if (!candidate?.standardizationId) {
        continue;
      }

      let jobResult = null;
      let pollError = null;

      if (candidate.standardizationJobId) {
        try {
          jobResult = await pollJobResilient(candidate.standardizationJobId, {
            headers,
            baseUrl,
          });
        } catch (error) {
          pollError = error;
          console.warn('[docupipe] candidate failed', {
            jobId: candidate.standardizationJobId || null,
            id: candidate.standardizationId || null,
            phase: 'poll',
            err: String(error),
          });
        }
      }

      let stdJson = null;
      try {
        stdJson = await getStandardizationWithRetry(candidate.standardizationId, {
          headers,
          baseUrl,
        });
      } catch (error) {
        console.warn('[docupipe] candidate failed', {
          jobId: candidate.standardizationJobId || null,
          id: candidate.standardizationId || null,
          phase: 'standardization',
          err: String(error),
        });
        continue;
      }

      if (!stdJson || typeof stdJson !== 'object') {
        console.warn('[docupipe] candidate failed', {
          jobId: candidate.standardizationJobId || null,
          id: candidate.standardizationId || null,
          phase: 'standardization',
          err: 'DocuPipe standardization payload was empty',
        });
        continue;
      }

      const type = resolveDocTypeFromSchema(stdJson) || 'unknown';
      const isPreferred = type === 'payslip' || type === 'statement';

      if (isPreferred || !selectedCandidate) {
        selectedCandidate = { ...candidate, type };
        selectedStdJson = stdJson;
        selectedJobResult = pollError ? null : jobResult;
        if (isPreferred) {
          break;
        }
      }
    }

    if (!selectedCandidate || !selectedStdJson) {
      await deleteObject(r2Key).catch(() => {});
      const emptyError = new Error('DocuPipe candidates exhausted without a completed standardization');
      emptyError.status = 502;
      throw emptyError;
    }

    const metadata = extractStandardizationMetadata(selectedStdJson);
    const docType = selectedCandidate.type || resolveDocTypeFromSchema(selectedStdJson) || 'unknown';
    const payload = extractDocumentPayload(selectedStdJson);

    console.log('[docupipe] selected', {
      jobId: selectedCandidate.standardizationJobId || null,
      id:
        metadata.standardizationId
        || selectedCandidate.standardizationId
        || null,
      schemaId: metadata.schemaId || null,
      schemaName: metadata.schemaName || null,
      type: docType,
    });

    const jobResult = selectedJobResult || null;

    let parsed = null;
    if (docType === 'payslip' || docType === 'statement') {
      try {
        parsed = docType === 'payslip' ? parsePayslip(payload) : parseStatement(payload);
      } catch (error) {
        logger.warn('Failed to parse DocuPipe standardization payload', {
          error: error.message,
          docType,
          standardizationId: metadata.standardizationId || selectedCandidate.standardizationId,
        });
        parsed = null;
      }
    }

    const rawDocupipeStatus =
      metadata.status
      || jobResult?.status
      || jobResult?.data?.status
      || (selectedStdJson ? 'completed' : null);
    const docupipeStatus = normaliseDocupipeStatus(rawDocupipeStatus, {
      hasStandardizationJob: Boolean(selectedCandidate.standardizationJobId),
    });

    const userObjectId = mongoose.Types.ObjectId.isValid(userId)
      ? new mongoose.Types.ObjectId(userId)
      : undefined;

    const documentResult = await DocumentResult.create({
      userId: userObjectId,
      fileUrl: buildDocumentResultFileUrl(r2Key),
      filename: originalname,
      uploadJobId: uploadJobId || null,
      standardizationJobId: selectedCandidate.standardizationJobId || null,
      standardizationId:
        metadata.standardizationId
        || selectedCandidate.standardizationId
        || null,
      documentId: metadata.documentId || null,
      schemaId: metadata.schemaId || null,
      schemaName: metadata.schemaName || null,
      type: docType,
      initialResponse: initial,
      finalJob: jobResult,
      standardization: selectedStdJson,
      status: docupipeStatus,
    });

    const docupipeInfo = {
      documentResultId: documentResult._id,
      uploadJobId: documentResult.uploadJobId || uploadJobId || null,
      standardizationJobId:
        documentResult.standardizationJobId
        || selectedCandidate.standardizationJobId
        || null,
      standardizationId:
        documentResult.standardizationId
        || metadata.standardizationId
        || selectedCandidate.standardizationId
        || null,
      documentId: documentResult.documentId || metadata.documentId || null,
      schemaId: documentResult.schemaId || metadata.schemaId || null,
      schemaName: documentResult.schemaName || metadata.schemaName || null,
      documentType: docType,
      status: documentResult.status,
      fileUrl: documentResult.fileUrl,
    };
    if (selectedCandidate.classificationJobId) {
      docupipeInfo.classificationJobId = selectedCandidate.classificationJobId;
    }
    if (selectedCandidate.classKey) {
      docupipeInfo.classKey = selectedCandidate.classKey;
    }
    if (selectedCandidate.source) {
      docupipeInfo.source = selectedCandidate.source;
    }
    docupipeInfo.schema = docupipeInfo.schemaName;
    docupipeInfo.jobId =
      docupipeInfo.standardizationJobId
      || docupipeInfo.uploadJobId
      || null;

    await UploadedDocument.findOneAndUpdate(
      { userId, contentHash },
      {
        userId,
        fileId,
        docType,
        month: parsed?.month || null,
        periodStart: parsed?.periodStart || null,
        periodEnd: parsed?.periodEnd || null,
        payDate: parsed?.payDate || null,
        contentHash,
        r2Key,
        originalName: originalname,
        contentType: mimetype,
        size,
        metadata: parsed?.metadata || {},
        analytics: parsed?.analytics || {},
        transactions: parsed?.transactions || [],
        docupipe: docupipeInfo,
        raw: {
          documentResultId: documentResult._id,
          standardizationId: docupipeInfo.standardizationId || null,
          documentId: docupipeInfo.documentId || null,
          schemaId: docupipeInfo.schemaId || null,
          schemaName: docupipeInfo.schemaName || null,
          standardization: selectedStdJson,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    logger.info(
      `[DocuPipe] uploadJobId=${docupipeInfo.uploadJobId || 'null'}, stdJobId=${docupipeInfo.standardizationJobId || 'null'}, stdId=${docupipeInfo.standardizationId || 'null'}, schemaId=${docupipeInfo.schemaId || 'null'}, schemaName=${
        docupipeInfo.schemaName || 'null'
      }, type=${docType}`
    );

    return res.status(201).json({
      id: String(documentResult._id),
      type: docType,
      standardizationId: docupipeInfo.standardizationId || null,
      documentId: docupipeInfo.documentId || null,
      schemaId: docupipeInfo.schemaId || null,
      schemaName: docupipeInfo.schemaName || null,
    });
  } catch (error) {
    if (r2Key) {
      await deleteObject(r2Key).catch(() => {});
    }
    return next(error);
  }
});

router.get('/documents', async (req, res, next) => {
  const userId = req.user.id;
  try {
    const documents = await UploadedDocument.find({ userId })
      .sort({ createdAt: -1 })
      .select({
        fileId: 1,
        docType: 1,
        month: 1,
        originalName: 1,
        payDate: 1,
        periodStart: 1,
        periodEnd: 1,
        size: 1,
        docupipe: 1,
        createdAt: 1,
        updatedAt: 1,
      })
      .lean();

    const response = documents.map((doc) => ({
      fileId: doc.fileId,
      docType: doc.docType,
      month: doc.month,
      originalName: doc.originalName || null,
      payDate: doc.payDate || null,
      periodStart: doc.periodStart || null,
      periodEnd: doc.periodEnd || null,
      size: doc.size ?? null,
      docupipe: formatDocupipe(doc),
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    }));

    return res.json({ documents: response });
  } catch (error) {
    return next(error);
  }
});

router.get('/documents/:fileId/json', async (req, res, next) => {
  const userId = req.user.id;
  const fileId = String(req.params.fileId || '');

  try {
    const document = await UploadedDocument.findOne({ userId, fileId }).lean();
    if (!document) {
      throw notFound('Document not found');
    }

    const docResultId = document.docupipe?.documentResultId || document.raw?.documentResultId || null;
    let docResult = null;
    if (docResultId) {
      const query = { _id: docResultId };
      if (mongoose.Types.ObjectId.isValid(userId)) {
        query.userId = new mongoose.Types.ObjectId(userId);
      }
      docResult = await DocumentResult.findOne(query).lean();
    }

    let jsonPayload = null;
    if (docResult) {
      if (docResult.standardization && typeof docResult.standardization === 'object') {
        jsonPayload = docResult.standardization;
      } else if (docResult.initialResponse && typeof docResult.initialResponse === 'object') {
        jsonPayload = docResult.initialResponse;
      } else {
        const finalCandidate =
          docResult.finalJob?.result
          || docResult.finalJob?.data
          || docResult.finalJob?.output
          || docResult.finalJob;
        if (finalCandidate && typeof finalCandidate === 'object') {
          jsonPayload = finalCandidate;
        }
      }
    }
    if (!jsonPayload && document.raw?.standardization) {
      jsonPayload = document.raw.standardization;
    }
    if (!jsonPayload) {
      jsonPayload = document.raw && Object.keys(document.raw || {}).length ? document.raw : null;
    }

    const docupipeResult = docResult
      ? {
          id: docResult._id,
          status: docResult.status,
          uploadJobId: docResult.uploadJobId,
          standardizationJobId: docResult.standardizationJobId,
          standardizationId: docResult.standardizationId,
          documentId: docResult.documentId || null,
          schemaId: docResult.schemaId || null,
          schemaName: docResult.schemaName || null,
          type: docResult.type || null,
          createdAt: docResult.createdAt,
          updatedAt: docResult.updatedAt,
        }
      : null;

    return res.json({
      fileId: document.fileId,
      docType: document.docType,
      month: document.month,
      originalName: document.originalName || null,
      payDate: document.payDate || null,
      periodStart: document.periodStart || null,
      periodEnd: document.periodEnd || null,
      docupipe: formatDocupipe(document),
      metadata: document.metadata || {},
      analytics: document.analytics || {},
      transactions: document.transactions || [],
      json: jsonPayload,
      raw: jsonPayload,
      docupipeResult,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/documents/:fileId/preview', async (req, res, next) => {
  const userId = req.user.id;
  const fileId = String(req.params.fileId || '');

  try {
    const document = await UploadedDocument.findOne({ userId, fileId })
      .select({ r2Key: 1, originalName: 1, contentType: 1 })
      .lean();
    if (!document) {
      throw notFound('Document not found');
    }
    if (!document.r2Key) {
      throw notFound('Document preview is not available');
    }

    const url = await createPresignedGet({ key: document.r2Key, expiresIn: 60 * 5 });
    return res.json({
      url,
      contentType: document.contentType || 'application/pdf',
      originalName: document.originalName || 'document.pdf',
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/analytics', async (req, res, next) => {
  const userId = req.user.id;
  const monthFilter = req.query.month ? String(req.query.month) : null;

  try {
    const documents = await UploadedDocument.find({ userId }).sort({ month: -1, createdAt: -1 }).lean();
    if (!documents.length) {
      return res.json({ months: [], selectedMonth: null, payslips: [], statements: [], summary: null });
    }

    const months = Array.from(new Set(documents.map((doc) => doc.month))).sort((a, b) => (a > b ? -1 : 1));
    const selectedMonth = monthFilter && months.includes(monthFilter) ? monthFilter : months[0];

    const monthDocs = documents.filter((doc) => doc.month === selectedMonth);
    const payslips = monthDocs
      .filter((doc) => doc.docType === 'payslip')
      .map((doc) => formatPayslipResponse(doc));
    const statements = monthDocs
      .filter((doc) => doc.docType === 'statement')
      .map((doc) => formatStatementResponse(doc));

    const summary = buildMonthSummary(payslips, statements);

    return res.json({
      months,
      selectedMonth,
      payslips,
      statements,
      summary,
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
