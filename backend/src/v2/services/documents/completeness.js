const dayjs = require('dayjs');
const { randomUUID } = require('crypto');
const UploadedDocument = require('../../models/UploadedDocument');
const { badRequest } = require('../../utils/errors');

function normaliseMonth(month) {
  const value = month || dayjs().format('YYYY-MM');
  const parsed = dayjs(`${value}-01`);
  if (!parsed.isValid()) {
    throw badRequest('month must be in YYYY-MM format');
  }
  return parsed.format('YYYY-MM');
}

function normaliseString(value, fallback = null) {
  const str = (value || '').toString().trim();
  if (!str) return fallback;
  return str;
}

function buildTokenPayload({ userId, month, docType, label }) {
  return {
    kind: 'completeness',
    userId,
    month,
    docType,
    label,
    nonce: randomUUID(),
    issuedAt: new Date().toISOString(),
  };
}

function encodeUploadToken(payload) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function parseUploadToken(token) {
  if (!token) return null;
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const payload = JSON.parse(decoded);
    if (payload?.kind !== 'completeness') return null;
    return payload;
  } catch (_error) {
    return null;
  }
}

function buildUploadHelper({ userId, month, docType, label }) {
  const payload = buildTokenPayload({ userId, month, docType, label });
  return {
    uploadUrl: '/api/v2/dashboard/documents',
    uploadToken: encodeUploadToken(payload),
    docType,
  };
}

function toEmployerKey(name) {
  return normaliseString(name || 'employer', 'employer').toLowerCase();
}

function toBankKey({ institutionName, accountName }) {
  const institution = normaliseString(institutionName, '').toLowerCase();
  const account = normaliseString(accountName || 'account', 'account').toLowerCase();
  return `${institution}:${account}`;
}

async function collectKnownEntities(userId) {
  const documents = await UploadedDocument.find({ userId })
    .select({ docType: 1, month: 1, metadata: 1 })
    .lean();

  const employers = new Map();
  const banks = new Map();

  documents.forEach((doc) => {
    if (doc.docType === 'payslip') {
      const name = normaliseString(doc.metadata?.employerName, 'Employer');
      const key = toEmployerKey(name);
      if (!employers.has(key)) {
        employers.set(key, { name });
      }
    }
    if (doc.docType === 'statement') {
      const accountName = normaliseString(doc.metadata?.accountName, 'Account');
      const institutionName = normaliseString(doc.metadata?.institutionName, null);
      const key = toBankKey({ institutionName, accountName });
      if (!banks.has(key)) {
        banks.set(key, {
          accountName,
          institutionName,
          label: institutionName ? `${institutionName} — ${accountName}` : accountName,
        });
      }
    }
  });

  return { employers, banks };
}

async function computeCompleteness({ userId, month }) {
  const targetMonth = normaliseMonth(month);
  const { employers: knownEmployers, banks: knownBanks } = await collectKnownEntities(userId);

  if (!knownEmployers.size && !knownBanks.size) {
    return {
      month: targetMonth,
      missing: { employers: [], banks: [] },
      known: { employers: [], banks: [] },
      uploaded: { employers: [], banks: [] },
    };
  }

  const monthDocs = await UploadedDocument.find({ userId, month: targetMonth })
    .select({ docType: 1, metadata: 1 })
    .lean();

  const monthEmployerKeys = new Set(
    monthDocs
      .filter((doc) => doc.docType === 'payslip')
      .map((doc) => toEmployerKey(doc.metadata?.employerName))
  );

  const monthBankKeys = new Set(
    monthDocs
      .filter((doc) => doc.docType === 'statement')
      .map((doc) => toBankKey({
        institutionName: doc.metadata?.institutionName,
        accountName: doc.metadata?.accountName,
      }))
  );

  const missingEmployers = Array.from(knownEmployers.entries())
    .filter(([key]) => !monthEmployerKeys.has(key))
    .map(([, employer]) => ({
      name: employer.name,
      upload: buildUploadHelper({ userId, month: targetMonth, docType: 'payslip', label: employer.name }),
    }));

  const missingBanks = Array.from(knownBanks.entries())
    .filter(([key]) => !monthBankKeys.has(key))
    .map(([, bank]) => ({
      accountName: bank.accountName,
      institutionName: bank.institutionName,
      label: bank.label,
      upload: buildUploadHelper({ userId, month: targetMonth, docType: 'statement', label: bank.label }),
    }));

  return {
    month: targetMonth,
    missing: { employers: missingEmployers, banks: missingBanks },
    known: {
      employers: Array.from(knownEmployers.values()),
      banks: Array.from(knownBanks.values()),
    },
    uploaded: {
      employers: Array.from(monthEmployerKeys),
      banks: Array.from(monthBankKeys),
    },
  };
}

function parseCompletenessToken(token, userId) {
  const payload = parseUploadToken(token);
  if (!payload || payload.userId !== userId) return null;
  return {
    month: payload.month || null,
    docType: payload.docType || null,
    label: payload.label || null,
  };
}

module.exports = {
  computeCompleteness,
  parseCompletenessToken,
};
