import { extractPdfText } from './extractPdfText.js';
import { harvestPayslipCandidates } from './heuristics/payslip';
import payslipSchemaV2 from './schemas/payslip.v2.json';
import { normaliseWithSchema } from './llm.js';
import { parseDateString } from '../config/dateParsing';

const toISO = (value?: string | null) => parseDateString(value ?? null);

const toNumber = (value: unknown): number | null => {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/[^0-9.-]/g, '');
  if (!cleaned) return null;
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

export async function extractPayslip(buffer: Buffer, meta?: { originalName?: string }) {
  const { fullText } = await extractPdfText(buffer);
  const cand = harvestPayslipCandidates(fullText);
  const llm = await normaliseWithSchema(fullText, cand, payslipSchemaV2).catch(() => ({}));
  // Reconcile
  const pay_date = toISO((llm as any)?.pay_date) || null;
  const month = pay_date?.slice(0, 7) || null;
  const result = {
    employer: (llm as any)?.employer ?? null,
    employeeName: (llm as any)?.employee_name ?? null,
    payDate: pay_date,
    payFrequency: (llm as any)?.pay_frequency ?? null,
    taxCode: (llm as any)?.tax_code ?? null,
    niLetter: (llm as any)?.ni_letter ?? null,
    gross: toNumber((llm as any)?.gross),
    net: toNumber((llm as any)?.net),
    tax: toNumber((llm as any)?.tax),
    ni: toNumber((llm as any)?.national_insurance),
    studentLoan: toNumber((llm as any)?.student_loan),
    pensionEmployee: toNumber((llm as any)?.pension_employee),
    pensionEmployer: toNumber((llm as any)?.pension_employer),
    ytd: (llm as any)?.ytd ?? null,
    period: { start: null, end: null, month },
    provenance: { date: pay_date ? 'llm' : 'unknown' },
  };
  return result;
}
