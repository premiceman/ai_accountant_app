const express = require('express');
const multer = require('multer');
const dayjs = require('dayjs');
const { randomUUID } = require('crypto');
const UploadedDocument = require('../models/UploadedDocument');
const { runWorkflow } = require('../services/docupipe');
const { writeBuffer, deleteObject } = require('../services/r2');
const { badRequest } = require('../utils/errors');
const { sha256 } = require('../utils/hashing');

const router = express.Router();

const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_MB || 20) * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

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

function normaliseDocTypeHint(value) {
  const hint = stringField(value);
  if (!hint) return null;
  const lower = hint.toLowerCase();
  if (/(payslip|pay slip|payroll|salary|earnings)/.test(lower)) return 'payslip';
  if (/(statement|bank|transaction|account)/.test(lower)) return 'statement';
  return null;
}

function detectDocType(result, { payload, typeHint } = {}) {
  const source = result?.data ?? result?.output ?? result;
  const doc = source?.documents?.[0] || source?.document || source;

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
      const response =
        duplicate.docType === 'payslip'
          ? formatPayslipResponse(duplicate)
          : formatStatementResponse(duplicate);
      return res.status(200).json({
        status: 'duplicate',
        docType: duplicate.docType,
        month: duplicate.month,
        document: response,
        message: 'This document was already processed.',
      });
    }

    const fileId = randomUUID();
    r2Key = buildDashboardKey({ userId, fileId, originalName: originalname });
    await writeBuffer(r2Key, buffer, mimetype || 'application/pdf');
    const typeHint = req.body?.typeHint ? String(req.body.typeHint) : undefined;
    let workflowResult;
    try {
      workflowResult = await runWorkflow({ buffer, filename: originalname, typeHint });
    } catch (error) {
      await deleteObject(r2Key).catch(() => {});
      throw error;
    }
    const payload = extractDocumentPayload(workflowResult);
    const docType = detectDocType(workflowResult, { payload, typeHint });
    if (!docType) {
      await deleteObject(r2Key).catch(() => {});
      throw badRequest('Docupipe did not return a supported document type');
    }

    let parsed;
    try {
      parsed = docType === 'payslip' ? parsePayslip(payload) : parseStatement(payload);
    } catch (error) {
      await deleteObject(r2Key).catch(() => {});
      throw error;
    }
    const record = await UploadedDocument.findOneAndUpdate(
      { userId, contentHash },
      {
        userId,
        fileId,
        docType,
        month: parsed.month,
        periodStart: parsed.periodStart,
        periodEnd: parsed.periodEnd,
        payDate: parsed.payDate || null,
        contentHash,
        r2Key,
        originalName: originalname,
        contentType: mimetype,
        size,
        metadata: parsed.metadata,
        analytics: parsed.analytics,
        transactions: parsed.transactions || [],
        raw: workflowResult,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    const response = docType === 'payslip' ? formatPayslipResponse(record) : formatStatementResponse(record);
    return res.status(201).json({
      status: 'processed',
      docType,
      month: record.month,
      document: response,
      message: 'Document processed successfully.',
    });
  } catch (error) {
    if (r2Key) {
      await deleteObject(r2Key).catch(() => {});
    }
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
