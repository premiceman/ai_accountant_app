import { extractPdfText } from './extractPdfText';
import { harvestPayslipCandidates } from './heuristics/payslip';
import payslipSchemaV2 from './schemas/payslip.v2.json';
import { normaliseWithSchema } from './llm';

const toISO = (s?: string | null) => {
  if (!s) return null;
  // Try common formats, fall back to Date.parse
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
};

export async function extractPayslip(buffer: Buffer, meta?: { originalName?: string }) {
  const { fullText } = await extractPdfText(buffer);
  const cand = harvestPayslipCandidates(fullText);
  const llm = await normaliseWithSchema(fullText, cand, payslipSchemaV2).catch(() => ({}));
  // Reconcile
  const pay_date = toISO((llm as any)?.pay_date) || null;
  const month = pay_date?.slice(0, 7) || null;
  const money = (v: any) => (v == null ? null : typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, '')));
  const result = {
    employer: (llm as any)?.employer ?? null,
    employeeName: (llm as any)?.employee_name ?? null,
    payDate: pay_date,
    payFrequency: (llm as any)?.pay_frequency ?? 'Monthly',
    taxCode: (llm as any)?.tax_code ?? null,
    niLetter: (llm as any)?.ni_letter ?? null,
    gross: money((llm as any)?.gross) ?? null,
    net: money((llm as any)?.net) ?? null,
    tax: money((llm as any)?.tax) ?? null,
    ni: money((llm as any)?.national_insurance) ?? null,
    studentLoan: money((llm as any)?.student_loan) ?? null,
    pensionEmployee: money((llm as any)?.pension_employee) ?? null,
    pensionEmployer: money((llm as any)?.pension_employer) ?? null,
    ytd: (llm as any)?.ytd ?? null,
    period: month ? { start: `${month}-01`, end: `${month}-28`, month } : { start: null, end: null, month: null },
    provenance: { date: pay_date ? 'llm' : 'unknown' },
  };
  return result;
}
