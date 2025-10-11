import { extractPdfText } from './extractPdfText.js';
import { harvestStatementCandidates, derivePeriodFromTxIso } from './heuristics/statement';
import statementSchemaV2 from './schemas/statement.v2.json';
import { normaliseWithSchema } from './llm.js';
import { parseDateString } from '../config/dateParsing';

const toISO = (value: unknown) => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      const iso = new Date(value);
      return Number.isNaN(iso.getTime()) ? null : iso.toISOString().slice(0, 10);
    }
    const parsed = parseDateString(value);
    if (parsed) return parsed;
  }
  const direct = new Date(value as any);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString().slice(0, 10);
  return typeof value === 'string' ? parseDateString(value) : null;
};

const toNumber = (value: unknown): number | null => {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/[^0-9.-]/g, '');
  if (!cleaned) return null;
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

export async function extractStatement(buffer: Buffer, meta?: { originalName?: string }) {
  const { fullText } = await extractPdfText(buffer);
  const { fields, txLines } = harvestStatementCandidates(fullText);
  const llm = await normaliseWithSchema(fullText, { fields, txLines }, statementSchemaV2).catch(() => ({} as any));
  const transactions = Array.isArray((llm as any)?.transactions)
    ? ((llm as any).transactions as any[])
    : [];

  const normalisedTx = transactions
    .map((t) => {
      const amount = toNumber(t.amount);
      if (amount == null) return null;
      const date = toISO(t.date);
      if (!date) return null;
      const direction = t.direction || (amount < 0 ? 'outflow' : 'inflow');
      return {
        date,
        description: String(t.description ?? t.merchant ?? 'Transaction').trim(),
        amount,
        direction,
        category: t.category ?? null,
      };
    })
    .filter((item): item is { date: string; description: string; amount: number; direction: string; category: string | null } => Boolean(item));

  const periodLLM = {
    start: toISO((llm as any)?.statement_period?.start_date),
    end: toISO((llm as any)?.statement_period?.end_date),
  };
  const periodTx = derivePeriodFromTxIso(normalisedTx.map((t) => t.date).filter(Boolean));
  const period = periodLLM.start && periodLLM.end ? periodLLM : periodTx;
  const inflows = normalisedTx.filter((t) => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
  const outflows = normalisedTx.filter((t) => t.amount < 0).reduce((sum, t) => sum + Math.abs(t.amount), 0);

  return {
    bankName: (llm as any)?.bank_name ?? null,
    accountNumberMasked: (llm as any)?.account_number ?? null,
    accountType: (llm as any)?.account_type ?? null,
    accountHolder: (llm as any)?.account_holder ?? null,
    period: { start: period.start ?? null, end: period.end ?? null },
    openingBalance: toNumber((llm as any)?.opening_balance),
    closingBalance: toNumber((llm as any)?.closing_balance),
    inflows,
    outflows,
    transactions: normalisedTx,
    provenance: { period: periodLLM.start ? 'llm' : 'transactions' },
  };
}
