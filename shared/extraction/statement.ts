import { extractPdfText } from './extractPdfText';
import { harvestStatementCandidates, derivePeriodFromTxIso } from './heuristics/statement';
import statementSchemaV2 from './schemas/statement.v2.json';
import { normaliseWithSchema } from './llm';

const iso = (s?: string | null) => {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

export async function extractStatement(buffer: Buffer, meta?: { originalName?: string }) {
  const { fullText } = await extractPdfText(buffer);
  const { fields, txLines } = harvestStatementCandidates(fullText);
  const llm = await normaliseWithSchema(fullText, { fields, txLines }, statementSchemaV2).catch(() => ({}));
  const tx = ((llm as any)?.transactions ?? []).map((t: any) => ({
    date: iso(t.date),
    description: String(t.description ?? '').trim(),
    amount: typeof t.amount === 'number' ? t.amount : parseFloat(String(t.amount).replace(/,/g, '')),
    direction: t.direction ?? (Number(t.amount) < 0 ? 'outflow' : 'inflow'),
    category: t.category ?? null
  })).filter((t: any) => t.date && !isNaN(t.amount));
  const periodLLM = { start: iso((llm as any)?.statement_period?.start_date), end: iso((llm as any)?.statement_period?.end_date) };
  const periodTx = derivePeriodFromTxIso(tx.map((t: any) => t.date).filter(Boolean));
  const period = (periodLLM.start && periodLLM.end) ? periodLLM : periodTx;
  const inflows = tx.filter((t: any) => t.amount > 0).reduce((a: any, b: any) => a + b.amount, 0);
  const outflows = tx.filter((t: any) => t.amount < 0).reduce((a: any, b: any) => a + Math.abs(b.amount), 0);
  return {
    bankName: (llm as any)?.bank_name ?? null,
    accountNumberMasked: (llm as any)?.account_number ?? null,
    accountType: (llm as any)?.account_type ?? null,
    accountHolder: (llm as any)?.account_holder ?? null,
    period: { start: period.start ?? null, end: period.end ?? null },
    openingBalance: (llm as any)?.opening_balance ?? null,
    closingBalance: (llm as any)?.closing_balance ?? null,
    inflows, outflows,
    transactions: tx,
    provenance: { period: periodLLM.start ? 'llm' : 'transactions' }
  };
}
