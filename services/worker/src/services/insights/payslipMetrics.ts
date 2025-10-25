import { format, isValid, parse, parseISO } from 'date-fns';
import type { DocumentInsight } from '../../models/documentInsight.js';

export type MoneyMinor = number;

export interface MetricsV1 {
  payDate: string;
  period: { start: string; end: string; month: string };
  employer: { name?: string } | string | null;
  grossMinor: MoneyMinor;
  netMinor: MoneyMinor;
  taxMinor: MoneyMinor;
  nationalInsuranceMinor: MoneyMinor;
  pensionMinor: MoneyMinor;
  studentLoanMinor: MoneyMinor;
  taxCode: string | null;
}

export type DocumentInsightLike = Partial<DocumentInsight> & {
  insightType?: string | null;
  catalogueKey?: string | null;
  metadata?: Record<string, unknown> | null;
  metrics?: Record<string, unknown> | null;
};

function parseDateFlexible(input?: string | Date | null): Date | null {
  if (!input) return null;
  if (input instanceof Date) {
    return isValid(input) ? input : null;
  }

  try {
    const iso = parseISO(input);
    if (isValid(iso)) return iso;
  } catch {
    // ignore
  }

  const native = new Date(input);
  if (isValid(native)) {
    return native;
  }

  const patterns = ['dd/MM/yyyy', 'd/M/yyyy', 'MM/yyyy'];
  for (const pattern of patterns) {
    try {
      const parsed = parse(input, pattern, new Date());
      if (isValid(parsed)) return parsed;
    } catch {
      // ignore parsing failure and continue
    }
  }

  return null;
}

function ensureIsoMonth(input: unknown): string | null {
  if (!input) return null;
  if (typeof input === 'string' && /^\d{4}-\d{2}$/.test(input)) {
    return input;
  }
  const parsed = parseDateFlexible(input as string | Date | null);
  if (!parsed) return null;
  return format(parsed, 'yyyy-MM');
}

function toMinorFromUnknown(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (Number.isFinite(numeric)) {
    return Math.round(numeric * 100);
  }
  return 0;
}

function normaliseCategory(raw?: string | null): string {
  const key = String(raw ?? '').trim().toLowerCase();
  if (!key) return '';
  if (key === 'ni' || key === 'national insurance' || key === 'nationalinsurance') {
    return 'national_insurance';
  }
  if (key === 'pension' || key === 'pension employee' || key === 'ae' || key === 'autoenrolment') {
    return 'pension_employee';
  }
  return key;
}

function findDeductionMinor(di: DocumentInsightLike, target: string): number {
  const collections: Array<Array<Record<string, unknown>>> = [];
  if (Array.isArray((di.metadata as Record<string, unknown> | undefined)?.deductions)) {
    collections.push(((di.metadata as Record<string, unknown>).deductions as Array<Record<string, unknown>>));
  }
  if (Array.isArray((di.metrics as Record<string, unknown> | undefined)?.deductions)) {
    collections.push(((di.metrics as Record<string, unknown>).deductions as Array<Record<string, unknown>>));
  }

  const normalisedTarget = normaliseCategory(target);
  for (const list of collections) {
    for (const deduction of list) {
      const category = normaliseCategory(deduction?.category as string | undefined);
      if (category === normalisedTarget) {
        return toMinorFromUnknown(deduction?.amountPeriod);
      }
    }
  }
  return 0;
}

function monthBoundsFromMonth(month: string): { start: string; end: string; month: string } {
  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const start = `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`;
  const end = format(new Date(Date.UTC(year, monthIndex + 1, 0)), 'yyyy-MM-dd');
  return { start, end, month };
}

function pickEmployerName(di: DocumentInsightLike): string | null {
  const metadata = (di.metadata ?? {}) as Record<string, unknown>;
  const employer = metadata.employer as Record<string, unknown> | undefined;
  if (employer && typeof employer === 'object' && typeof employer.name === 'string') {
    const trimmed = employer.name.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  const rawName =
    (metadata.employerName as string | undefined) ??
    (metadata.employer_name as string | undefined) ??
    ((di.metrics as Record<string, unknown> | undefined)?.employerName as string | undefined) ??
    ((di.metrics as Record<string, unknown> | undefined)?.employer_name as string | undefined);
  if (typeof rawName === 'string') {
    const trimmed = rawName.trim();
    return trimmed ? trimmed : null;
  }
  return null;
}

export function buildPayslipMetricsV1(di: DocumentInsightLike): MetricsV1 {
  if (!di) {
    throw new Error('buildPayslipMetricsV1 requires a document insight');
  }
  const type = String(di.insightType ?? di.catalogueKey ?? '').toLowerCase();
  if (type !== 'payslip') {
    throw new Error('buildPayslipMetricsV1 expects a payslip insight');
  }

  const metadata = (di.metadata ?? {}) as Record<string, unknown>;
  const metrics = (di.metrics ?? {}) as Record<string, unknown>;
  const periodMeta = (metadata.period ?? {}) as Record<string, unknown>;

  const dateCandidates: Array<string | Date | null | undefined> = [
    (di as { documentDateV1?: string | null }).documentDateV1,
    (di as { documentDate?: string | Date | null }).documentDate,
    metadata.documentDate as string | Date | null | undefined,
    metadata.payDate as string | Date | null | undefined,
    periodMeta.end as string | Date | null | undefined,
    periodMeta.Date as string | Date | null | undefined,
    metrics.payDate as string | Date | null | undefined,
    di.documentMonth ? `${di.documentMonth}-28` : null,
  ];

  let payDateValue: Date | null = null;
  for (const candidate of dateCandidates) {
    const parsed = parseDateFlexible(candidate as string | Date | null | undefined);
    if (parsed) {
      payDateValue = parsed;
      break;
    }
  }

  if (!payDateValue) {
    throw new Error('Unable to determine pay date for payslip insight');
  }

  const payDate = format(payDateValue, 'yyyy-MM-dd');

  const parsedPeriodStart = parseDateFlexible(periodMeta.start as string | Date | null | undefined);
  const parsedPeriodEnd = parseDateFlexible(periodMeta.end as string | Date | null | undefined);

  let periodMonth =
    (typeof di.documentMonth === 'string' && /^\d{4}-\d{2}$/.test(di.documentMonth) ? di.documentMonth : null) ??
    ensureIsoMonth(periodMeta.month) ??
    ensureIsoMonth(periodMeta.Date) ??
    null;

  if (!periodMonth && parsedPeriodStart && parsedPeriodEnd) {
    const startMonth = format(parsedPeriodStart, 'yyyy-MM');
    const endMonth = format(parsedPeriodEnd, 'yyyy-MM');
    if (startMonth === endMonth) {
      periodMonth = startMonth;
    }
  }

  if (!periodMonth) {
    periodMonth = format(payDateValue, 'yyyy-MM');
  }

  if (!periodMonth) {
    throw new Error('Unable to determine payslip period month');
  }

  const defaultPeriod = monthBoundsFromMonth(periodMonth);
  let periodStart = defaultPeriod.start;
  if (parsedPeriodStart && format(parsedPeriodStart, 'yyyy-MM') === periodMonth) {
    periodStart = format(parsedPeriodStart, 'yyyy-MM-dd');
  }
  let periodEnd = defaultPeriod.end;
  if (parsedPeriodEnd && format(parsedPeriodEnd, 'yyyy-MM') === periodMonth) {
    periodEnd = format(parsedPeriodEnd, 'yyyy-MM-dd');
  }

  const totals = (metadata.totals ?? {}) as Record<string, unknown>;
  const grossMinorDirect = toMinorFromUnknown(totals.grossPeriod ?? totals.gross);
  const netMinorDirect = toMinorFromUnknown(totals.netPeriod ?? totals.net);

  const earnings = Array.isArray(metadata.earnings)
    ? (metadata.earnings as Array<Record<string, unknown>>)
    : Array.isArray(metrics.earnings)
    ? (metrics.earnings as Array<Record<string, unknown>>)
    : [];
  const deductions = Array.isArray(metadata.deductions)
    ? (metadata.deductions as Array<Record<string, unknown>>)
    : Array.isArray(metrics.deductions)
    ? (metrics.deductions as Array<Record<string, unknown>>)
    : [];

  const sumPeriods = (items: Array<Record<string, unknown>>): number =>
    items.reduce((acc, item) => {
      const amount = toMinorFromUnknown(item.amountPeriod);
      return acc + amount;
    }, 0);

  const derivedGrossMinor = sumPeriods(earnings);
  const derivedDeductionsMinor = sumPeriods(deductions);
  const derivedNetMinor = derivedGrossMinor - derivedDeductionsMinor;

  const legacyGrossMinor = toMinorFromUnknown(metrics.gross);
  const legacyNetMinor = toMinorFromUnknown(metrics.net);

  const grossMinor = grossMinorDirect || derivedGrossMinor || legacyGrossMinor;
  const netMinor = netMinorDirect || derivedNetMinor || legacyNetMinor;

  const taxMinor = findDeductionMinor(di, 'income_tax') || toMinorFromUnknown(metrics.tax);
  const nationalInsuranceMinor =
    findDeductionMinor(di, 'national_insurance') || toMinorFromUnknown(metrics.ni ?? metrics.nationalInsurance);
  const pensionMinor = findDeductionMinor(di, 'pension_employee') || toMinorFromUnknown(metrics.pension);
  const studentLoanMinor = findDeductionMinor(di, 'student_loan') || toMinorFromUnknown(metrics.studentLoan);

  const employerName = pickEmployerName(di);
  const employer = employerName ? { name: employerName } : null;

  const taxCode =
    typeof (metadata.employee as Record<string, unknown> | undefined)?.taxCode === 'string'
      ? ((metadata.employee as Record<string, unknown>).taxCode as string)
      : typeof metadata.taxCode === 'string'
      ? (metadata.taxCode as string)
      : typeof metrics.taxCode === 'string'
      ? (metrics.taxCode as string)
      : null;

  return {
    payDate,
    period: { start: periodStart, end: periodEnd, month: periodMonth },
    employer,
    grossMinor,
    netMinor,
    taxMinor,
    nationalInsuranceMinor,
    pensionMinor,
    studentLoanMinor,
    taxCode,
  };
}
