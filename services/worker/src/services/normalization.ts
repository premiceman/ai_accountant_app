import dayjs from 'dayjs';
import { hashPII, maskNI, accountLast4, niLast3 } from '../lib/pii.js';

export type CanonicalPayslip = {
  payDate: string | null;
  period: { start: string | null; end: string | null };
  employer: { name: string | null };
  totals: {
    gross: number | null;
    incomeTax: number | null;
    nationalInsurance: number | null;
    pension: number | null;
    studentLoan: number | null;
    otherDeductions: number | null;
    otherSource: 'provided' | 'computed';
    net: number | null;
  };
  identifiers: {
    taxCode?: string | null;
    niNumberMasked?: string | null;
    niHash?: string | null;
  };
};

export type CanonicalStatement = {
  institution: { name: string | null };
  account: {
    sortCodeMasked?: string | null;
    accountLast4?: string | null;
    accountHash?: string | null;
  };
  period: { start: string | null; end: string | null };
  openingBalance?: number | null;
  closingBalance?: number | null;
  currency: string;
  transactions: Array<{
    date: string | null;
    description: string | null;
    amount: number;
    direction: 'inflow' | 'outflow';
  }>;
};

export type NormalizationResult<T> = {
  normalized: T;
  integrity: { status: 'pass' | 'fail'; reason?: string; delta?: number };
  pii?: { accountLast4?: string | null; niLast3?: string | null };
};

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value * 100) / 100;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const cleaned = trimmed
      .replace(/[£$,]/g, '')
      .replace(/(GBP|USD|EUR|\s)/gi, '')
      .replace(/[()]/g, (match) => (match === '(' ? '-' : ''));
    if (!cleaned) return null;
    const parsed = Number.parseFloat(cleaned);
    if (!Number.isFinite(parsed)) return null;
    return Math.round(parsed * 100) / 100;
  }
  return null;
}

function toDateString(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return dayjs(value).format('YYYY-MM-DD');
  }
  const str = String(value).trim();
  if (!str) return null;
  const parsed = dayjs(str);
  if (!parsed.isValid()) return null;
  return parsed.format('YYYY-MM-DD');
}

function detectSchema(value: unknown): string {
  if (!value) return '';
  return String(value).toLowerCase();
}

function findFirst<T>(...values: Array<T | null | undefined>): T | null {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return value as T;
    }
  }
  return null;
}

function coerceNumber(value: unknown): number | null {
  const parsed = toNumber(value);
  if (parsed === null) return null;
  return Math.round(parsed * 100) / 100;
}

function sum(values: Array<number | null | undefined>): number {
  return values.reduce<number>((acc, value) => {
    return acc + (typeof value === 'number' ? value : 0);
  }, 0);
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function normaliseOther(
  gross: number,
  incomeTax: number,
  nationalInsurance: number,
  pension: number,
  studentLoan: number,
  net: number,
  providedOther: number | null
): { amount: number; source: 'provided' | 'computed' } {
  const computed = roundCurrency(gross - (incomeTax + nationalInsurance + pension + studentLoan) - net);
  if (providedOther === null || Math.abs(providedOther - computed) > 0.01) {
    return { amount: computed, source: 'computed' };
  }
  return { amount: providedOther, source: 'provided' };
}

export function detectDocumentType(raw: any): 'payslip' | 'bankStatement' | 'unknown' {
  const schemaHints = [raw?.schema, raw?.schemaName, raw?.documentType, raw?.type]
    .map(detectSchema)
    .filter(Boolean);
  const classificationName = detectSchema(raw?.classification?.name);
  const combined = new Set(schemaHints);
  if (classificationName) combined.add(classificationName);

  const joined = Array.from(combined).join(' ');
  if (joined.includes('payslip') || joined.includes('payroll')) {
    return 'payslip';
  }
  if (joined.includes('statement') || joined.includes('bank') || joined.includes('account')) {
    return 'bankStatement';
  }

  if (Array.isArray(raw?.transactions) || Array.isArray(raw?.statement?.transactions)) {
    return 'bankStatement';
  }
  if (raw?.totals?.gross || raw?.payDate || raw?.employment) {
    return 'payslip';
  }

  return 'unknown';
}

export function normalizePayslip(raw: any): NormalizationResult<CanonicalPayslip> {
  const payDate = toDateString(findFirst(raw?.payDate, raw?.paymentDate, raw?.summary?.payDate));
  const periodStart = toDateString(findFirst(raw?.period?.start, raw?.periodStart, raw?.summary?.period?.start));
  const periodEnd = toDateString(findFirst(raw?.period?.end, raw?.periodEnd, raw?.summary?.period?.end));
  const employerName = findFirst<string | null>(
    raw?.employer?.name,
    raw?.employerName,
    raw?.company?.name,
    raw?.organisation?.name
  );

  const totalsSource = raw?.totals || raw?.summary || raw?.paySummary || {};

  const gross = coerceNumber(
    findFirst(
      totalsSource?.gross,
      totalsSource?.totalGross,
      raw?.grossPay,
      raw?.earnings?.total,
      raw?.totals?.gross
    )
  ) ?? 0;
  const incomeTax = coerceNumber(
    findFirst(
      totalsSource?.incomeTax,
      totalsSource?.tax,
      totalsSource?.payAsYouEarn,
      raw?.incomeTax,
      raw?.deductions?.incomeTax
    )
  ) ?? 0;
  const nationalInsurance = coerceNumber(
    findFirst(
      totalsSource?.nationalInsurance,
      totalsSource?.ni,
      totalsSource?.nationalInsuranceContributions,
      raw?.nationalInsurance,
      raw?.deductions?.nationalInsurance
    )
  ) ?? 0;
  const pension = coerceNumber(
    findFirst(
      totalsSource?.pension,
      totalsSource?.pensionContribution,
      raw?.deductions?.pension,
      raw?.pension
    )
  ) ?? 0;
  const studentLoan = coerceNumber(findFirst(totalsSource?.studentLoan, raw?.deductions?.studentLoan)) ?? 0;
  const net = coerceNumber(findFirst(totalsSource?.net, totalsSource?.netPay, raw?.netPay, raw?.totals?.net)) ?? 0;
  const otherProvided = coerceNumber(
    findFirst(totalsSource?.otherDeductions, totalsSource?.other, raw?.deductions?.other)
  );

  const other = normaliseOther(gross, incomeTax, nationalInsurance, pension, studentLoan, net, otherProvided ?? null);

  const expectedNet = roundCurrency(gross - (incomeTax + nationalInsurance + pension + studentLoan + other.amount));
  const delta = roundCurrency(expectedNet - net);
  const integrity: NormalizationResult<CanonicalPayslip>['integrity'] = {
    status: Math.abs(delta) <= 0.01 ? 'pass' : 'fail',
  };
  if (integrity.status === 'fail') {
    integrity.reason = 'net_identity_failed';
    integrity.delta = delta;
  }

  const niNumberRaw = findFirst<string | null>(
    raw?.employee?.nationalInsuranceNumber,
    raw?.nationalInsuranceNumber,
    raw?.employee?.niNumber,
    raw?.employee?.ni,
    raw?.niNumber
  );
  const niMasked = niNumberRaw ? maskNI(niNumberRaw) : null;
  const niHashValue = niNumberRaw ? hashPII(niNumberRaw) : null;

  const normalized: CanonicalPayslip = {
    payDate,
    period: { start: periodStart, end: periodEnd },
    employer: { name: employerName ?? null },
    totals: {
      gross,
      incomeTax,
      nationalInsurance,
      pension,
      studentLoan,
      otherDeductions: other.amount,
      otherSource: other.source,
      net,
    },
    identifiers: {},
  };

  if (raw?.employee?.taxCode || raw?.taxCode) {
    normalized.identifiers.taxCode = String(raw?.employee?.taxCode ?? raw?.taxCode ?? '').trim() || null;
  }
  if (niMasked) {
    normalized.identifiers.niNumberMasked = niMasked;
  }
  if (niHashValue) {
    normalized.identifiers.niHash = niHashValue;
  }

  const pii: NormalizationResult<CanonicalPayslip>['pii'] = {};
  const niTail = niLast3(niNumberRaw);
  if (niTail) {
    pii.niLast3 = niTail;
  }

  return { normalized, integrity, pii };
}

function resolveSortCode(raw: any): string | null {
  const candidates = [raw?.account?.sortCode, raw?.sortCode, raw?.account?.routingNumber];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const cleaned = String(candidate).replace(/[^0-9]/g, '');
    if (cleaned.length >= 6) {
      return `${cleaned.slice(0, 2)}-${cleaned.slice(2, 4)}-${cleaned.slice(4, 6)}`;
    }
  }
  return null;
}

function normaliseTransactionAmount(item: any): number {
  const amount = coerceNumber(item?.amount);
  const credit = coerceNumber(item?.credit);
  const debit = coerceNumber(item?.debit);

  if (amount !== null) {
    return amount;
  }

  const computed = (credit ?? 0) - (debit ?? 0);
  return roundCurrency(computed);
}

function determineDirection(amount: number): 'inflow' | 'outflow' {
  return amount >= 0 ? 'inflow' : 'outflow';
}

function extractTransactions(raw: any): CanonicalStatement['transactions'] {
  const source = Array.isArray(raw?.transactions)
    ? raw.transactions
    : Array.isArray(raw?.statement?.transactions)
    ? raw.statement.transactions
    : Array.isArray(raw?.activity)
    ? raw.activity
    : [];

  return source
    .map((entry: any) => {
      const amount = normaliseTransactionAmount(entry);
      return {
        date: toDateString(findFirst(entry?.date, entry?.postedDate, entry?.transactionDate)),
        description: findFirst<string | null>(
          entry?.description,
          entry?.narrative,
          entry?.merchant,
          entry?.summary
        ),
        amount,
        direction: determineDirection(amount),
      };
    })
    .filter(
      (item: { amount: number }): item is CanonicalStatement['transactions'][number] =>
        typeof item.amount === 'number' && !Number.isNaN(item.amount)
    );
}

export function normalizeStatement(raw: any): NormalizationResult<CanonicalStatement> {
  const institutionName = findFirst<string | null>(
    raw?.institution?.name,
    raw?.bank?.name,
    raw?.account?.institution,
    raw?.institutionName
  );
  const sortCode = resolveSortCode(raw);
  const accountNumber = findFirst<string | null>(raw?.account?.number, raw?.accountNumber, raw?.account?.iban);
  const accountDigits = accountNumber ? accountNumber.replace(/[^0-9]/g, '') : '';
  const accountLast = accountLast4(accountDigits || accountNumber);
  const accountHash = accountNumber ? hashPII(accountNumber) : null;

  const periodStart = toDateString(findFirst(raw?.period?.start, raw?.statement?.period?.from, raw?.fromDate));
  const periodEnd = toDateString(findFirst(raw?.period?.end, raw?.statement?.period?.to, raw?.toDate));

  const openingBalance = coerceNumber(
    findFirst(raw?.balances?.opening, raw?.openingBalance, raw?.statement?.openingBalance)
  );
  const closingBalance = coerceNumber(
    findFirst(raw?.balances?.closing, raw?.closingBalance, raw?.statement?.closingBalance)
  );
  const currency = (raw?.currency || raw?.statement?.currency || 'GBP') as string;

  const transactions = extractTransactions(raw);

  const inflow = sum(transactions.filter((t) => t.direction === 'inflow').map((t) => t.amount));
  const outflow = sum(transactions.filter((t) => t.direction === 'outflow').map((t) => Math.abs(t.amount)));

  const integrity: NormalizationResult<CanonicalStatement>['integrity'] = { status: 'pass' };

  if (openingBalance !== null && closingBalance !== null) {
    const expectedClosing = roundCurrency((openingBalance ?? 0) + inflow - outflow);
    const delta = roundCurrency(expectedClosing - (closingBalance ?? 0));
    if (Math.abs(delta) > 0.01) {
      integrity.status = 'fail';
      integrity.reason = 'balance_mismatch';
      integrity.delta = delta;
    }
  } else {
    integrity.status = 'fail';
    integrity.reason = 'balance_mismatch';
    integrity.delta = undefined;
  }

  const normalized: CanonicalStatement = {
    institution: { name: institutionName ?? null },
    account: {},
    period: { start: periodStart, end: periodEnd },
    openingBalance,
    closingBalance,
    currency: currency || 'GBP',
    transactions,
  };

  if (sortCode) {
    normalized.account.sortCodeMasked = sortCode.replace(/\d(?=\d{2}-\d{2}$)/g, '\u2022');
  }
  if (accountLast) {
    normalized.account.accountLast4 = accountLast;
  }
  if (accountHash) {
    normalized.account.accountHash = accountHash;
  }

  const pii: NormalizationResult<CanonicalStatement>['pii'] = {};
  if (accountLast) {
    pii.accountLast4 = accountLast;
  }

  return { normalized, integrity, pii };
}
