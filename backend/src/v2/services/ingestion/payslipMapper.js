const { badRequest } = require('../../utils/errors');
const { toPence } = require('../../utils/money');

function normaliseDate(input) {
  if (!input) return null;
  const str = String(input).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const parts = str.split(/[\/-]/).map((p) => p.trim());
  if (parts.length === 3) {
    let [a, b, c] = parts;
    if (a.length === 2 && c.length === 4) {
      return `${c}-${a.padStart(2, '0')}-${b.padStart(2, '0')}`;
    }
    if (a.length === 4 && b.length === 2 && c.length === 2) {
      return `${a}-${b}-${c}`;
    }
  }
  return null;
}

function ensureDate(value, label) {
  const normalised = normaliseDate(value);
  if (!normalised) {
    throw badRequest(`Invalid ${label} date`);
  }
  return normalised;
}

function mapDeductions(raw = {}) {
  return {
    incomeTax: toPence(raw.incomeTax ?? raw.income_tax ?? 0),
    nationalInsurance: toPence(raw.nationalInsurance ?? raw.ni ?? 0),
    pension: toPence(raw.pension ?? 0),
    studentLoan: toPence(raw.studentLoan ?? raw.student_loan ?? 0),
    otherDeductions: toPence(raw.otherDeductions ?? raw.other ?? 0),
  };
}

function mapPayslip(doc, { fileId, contentHash }) {
  if (!doc) throw badRequest('Missing Docupipe payload');
  const meta = doc.standardized || doc.standardised || doc.payload || doc;
  const period = meta.period || meta.payPeriod || {};
  const earnings = Array.isArray(meta.earnings) ? meta.earnings : [];
  const provenance = {
    fileId,
    page: Number(meta.page || 1),
    anchor: meta.anchor || 'document',
  };

  const mapped = {
    docType: 'payslip',
    fileId,
    contentHash,
    payPeriod: {
      start: ensureDate(period.start || period.from, 'period.start'),
      end: ensureDate(period.end || period.to, 'period.end'),
      paymentDate: ensureDate(period.paymentDate || period.payDate || period.end || period.to, 'paymentDate'),
    },
    employee: {
      name: meta.employee?.name || meta.employeeName || 'Employee',
      id: meta.employee?.id || meta.employeeId || undefined,
    },
    employer: {
      name: meta.employer?.name || meta.employerName || 'Employer',
      registration: meta.employer?.registration || meta.employer?.taxId || undefined,
    },
    grossPay: toPence(meta.grossPay ?? meta.gross ?? meta.totalGross ?? 0),
    netPay: toPence(meta.netPay ?? meta.net ?? meta.takeHome ?? 0),
    deductions: mapDeductions(meta.deductions || {}),
    earnings: earnings.map((entry, index) => ({
      label: entry.label || entry.name || `Earning ${index + 1}`,
      amount: toPence(entry.amount ?? entry.value ?? 0),
      provenance: {
        fileId,
        page: Number(entry.page || meta.page || 1),
        anchor: entry.anchor || `earnings.${index}`,
      },
    })),
    provenance,
    metadata: {
      currency: meta.currency || 'GBP',
    },
  };

  return mapped;
}

module.exports = { mapPayslip };
