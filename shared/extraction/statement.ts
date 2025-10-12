import { extractPdfText } from './extractPdfText.js';
import {
  harvestStatementCandidates,
  derivePeriodFromTxIso,
  ColumnBoundaryHint,
  RowCluster,
} from './heuristics/statement';
import statementSchemaV2 from './schemas/statement.v2.json';
import { normaliseWithSchema } from './llm.js';
import { parseDateString } from '../config/dateParsing';

type BuilderTransactionInput = {
  date?: string | null;
  description?: string | null;
  amount?: string | number | null;
  direction?: string | null;
  category?: string | null;
};

type NormalisedTransaction = {
  date: string;
  description: string;
  amount: number;
  direction: 'inflow' | 'outflow';
  category: string | null;
};

type MergeDiscrepancy = {
  type: 'amount-mismatch' | 'missing-builder' | 'builder-only';
  date: string;
  description: string;
  llmAmount?: number;
  builderAmount?: number;
};

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

const normaliseDescription = (value: unknown): string => {
  const text = String(value ?? '').trim();
  return text || 'Transaction';
};

const normaliseBuilderTransactions = (input: BuilderTransactionInput[]): NormalisedTransaction[] => {
  return input
    .map((tx) => {
      const amount = toNumber(tx.amount);
      if (amount == null) return null;
      const date = toISO(tx.date ?? null);
      if (!date) return null;
      const direction: 'inflow' | 'outflow' = amount < 0 ? 'outflow' : 'inflow';
      return {
        date,
        description: normaliseDescription(tx.description),
        amount,
        direction,
        category: tx.category ?? null,
      } as NormalisedTransaction;
    })
    .filter((item): item is NormalisedTransaction => Boolean(item));
};

function mergeTransactions(
  llm: NormalisedTransaction[],
  builder: NormalisedTransaction[]
): { transactions: NormalisedTransaction[]; discrepancies: MergeDiscrepancy[]; appliedBuilder: number } {
  if (!builder.length) {
    return { transactions: llm, discrepancies: [], appliedBuilder: 0 };
  }

  const byKey = new Map<string, NormalisedTransaction[]>();
  builder.forEach((tx) => {
    const key = `${tx.date}::${tx.description.toLowerCase()}`;
    const existing = byKey.get(key) ?? [];
    existing.push(tx);
    byKey.set(key, existing);
  });

  const merged: NormalisedTransaction[] = [];
  const discrepancies: MergeDiscrepancy[] = [];
  let appliedBuilder = 0;

  llm.forEach((tx) => {
    const key = `${tx.date}::${tx.description.toLowerCase()}`;
    const matches = byKey.get(key);
    if (matches && matches.length) {
      const candidate = matches.shift()!;
      appliedBuilder += 1;
      const delta = Math.abs(candidate.amount - tx.amount);
      if (delta > 0.01) {
        discrepancies.push({
          type: 'amount-mismatch',
          date: tx.date,
          description: tx.description,
          llmAmount: tx.amount,
          builderAmount: candidate.amount,
        });
        merged.push({
          ...candidate,
          direction: candidate.direction ?? (candidate.amount < 0 ? 'outflow' : 'inflow'),
          category: tx.category ?? candidate.category ?? null,
        });
      } else {
        merged.push({
          ...tx,
          amount: candidate.amount,
          direction: candidate.direction ?? tx.direction,
          category: tx.category ?? candidate.category ?? null,
        });
      }
      if (!matches.length) {
        byKey.delete(key);
      }
    } else {
      discrepancies.push({
        type: 'missing-builder',
        date: tx.date,
        description: tx.description,
        llmAmount: tx.amount,
      });
      merged.push(tx);
    }
  });

  byKey.forEach((remaining) => {
    remaining.forEach((tx) => {
      discrepancies.push({
        type: 'builder-only',
        date: tx.date,
        description: tx.description,
        builderAmount: tx.amount,
      });
      merged.push(tx);
    });
  });

  return { transactions: merged, discrepancies, appliedBuilder };
}

export async function extractStatement(
  buffer: Buffer,
  meta?: { originalName?: string; schematicTransactions?: BuilderTransactionInput[] | null }
) {
  const { fullText } = await extractPdfText(buffer);
  const { fields, txLines, rowClusters, columnHints } = harvestStatementCandidates(fullText);
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
      const direction: 'inflow' | 'outflow' = (t.direction as 'inflow' | 'outflow') ?? (amount < 0 ? 'outflow' : 'inflow');
      return {
        date,
        description: normaliseDescription(t.description ?? (t as any)?.merchant),
        amount,
        direction,
        category: t.category ?? null,
      } as NormalisedTransaction;
    })
    .filter((item): item is NormalisedTransaction => Boolean(item));

  const builderInput = Array.isArray(meta?.schematicTransactions) ? meta?.schematicTransactions ?? [] : [];
  const builderNormalised = normaliseBuilderTransactions(builderInput);
  const { transactions: mergedTransactions, discrepancies, appliedBuilder } = mergeTransactions(normalisedTx, builderNormalised);

  const periodLLM = {
    start: toISO((llm as any)?.statement_period?.start_date),
    end: toISO((llm as any)?.statement_period?.end_date),
  };
  const periodTx = derivePeriodFromTxIso(mergedTransactions.map((t) => t.date).filter(Boolean));
  const period = periodLLM.start && periodLLM.end ? periodLLM : periodTx;
  const inflows = mergedTransactions.filter((t) => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
  const outflows = mergedTransactions.filter((t) => t.amount < 0).reduce((sum, t) => sum + Math.abs(t.amount), 0);

  const provenance: Record<string, unknown> = {
    period: periodLLM.start ? 'llm' : 'transactions',
  };
  if (builderNormalised.length) {
    provenance.builder = {
      provided: builderNormalised.length,
      applied: appliedBuilder,
      discrepancies,
    };
  }
  if (rowClusters.length || columnHints.length) {
    provenance.heuristics = {
      clusters: rowClusters.map((cluster: RowCluster) => ({
        id: cluster.id,
        firstLineIndex: cluster.firstLineIndex,
        averageSpacing: cluster.averageSpacing,
        lineCount: cluster.lineCount,
      })),
      columnHints: columnHints.slice(0, 12).map((hint: ColumnBoundaryHint) => ({
        key: hint.key,
        start: hint.start,
        end: hint.end,
        rowIndex: hint.rowIndex,
      })),
    };
  }

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
    transactions: mergedTransactions,
    provenance,
  };
}
