const DATE_PAT = [
  /\b\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\,?\s+\d{2,4}\b/gi,
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\b\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}\b/g
];
const SCAN_HEADERS = [/statement period/i, /closing balance/i, /sort code/i, /account number/i, /iban/i];
const MONEY_PAT = /(?:(?:£|\$|€)\s*)?-?\(?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})\)?/;

export type Tx = { date?: string; description?: string; amount?: string };

export type ColumnBoundaryHint = {
  key: 'date' | 'description' | 'amount';
  start: number;
  end: number;
  sample: string;
  rowIndex: number;
};

export interface RowCluster {
  id: string;
  firstLineIndex: number;
  sampleLines: string[];
  averageSpacing: number;
  columnHints: ColumnBoundaryHint[];
  lineCount: number;
}

function normaliseWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function sliceColumn(line: string, start: number, end: number): string {
  const safeStart = Math.max(0, Math.min(start, line.length));
  const safeEnd = Math.max(safeStart, Math.min(end, line.length));
  return line.slice(safeStart, safeEnd).trim();
}

function inferColumnHints(line: string, rowIndex: number): ColumnBoundaryHint[] {
  const segments = [] as { start: number; end: number; value: string }[];
  const matcher = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(line))) {
    const value = match[0];
    const start = match.index;
    const end = start + value.length;
    segments.push({ start, end, value });
  }
  if (!segments.length) return [];
  const hints: ColumnBoundaryHint[] = [];
  const first = segments[0];
  if (DATE_PAT.some((rx) => rx.test(first.value))) {
    hints.push({ key: 'date', start: first.start, end: first.end + 1, sample: first.value, rowIndex });
  }
  const amountSegment = [...segments].reverse().find((seg) => MONEY_PAT.test(seg.value));
  if (amountSegment) {
    hints.push({
      key: 'amount',
      start: Math.max(0, amountSegment.start - 1),
      end: amountSegment.end,
      sample: amountSegment.value,
      rowIndex,
    });
  }
  if (segments.length >= 2) {
    const last = amountSegment ?? segments[segments.length - 1];
    const descStart = first ? first.end + 1 : 0;
    const descEnd = last ? last.start - 1 : line.length;
    if (descEnd > descStart) {
      const sample = sliceColumn(line, descStart, descEnd);
      if (sample) {
        hints.push({ key: 'description', start: descStart, end: descEnd, sample, rowIndex });
      }
    }
  }
  return hints;
}

function signatureForLine(line: string): string {
  const parts = line
    .split(/\s{2,}/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  return `${parts.length}:${parts.map((p) => p.replace(/[A-Za-z0-9]/g, 'x')).join('|')}`;
}

function buildRowClusters(lines: string[]): RowCluster[] {
  const candidateLines = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => DATE_PAT.some((rx) => rx.test(line)) && MONEY_PAT.test(line));
  if (!candidateLines.length) return [];
  const groups = new Map<string, {
    id: string;
    rows: { line: string; index: number }[];
  }>();
  candidateLines.forEach(({ line, index }) => {
    const sig = signatureForLine(line);
    const group = groups.get(sig) ?? { id: `cluster-${groups.size + 1}`, rows: [] };
    group.rows.push({ line, index });
    groups.set(sig, group);
  });
  return Array.from(groups.values())
    .map((group) => {
      const sorted = group.rows.sort((a, b) => a.index - b.index);
      const spacings: number[] = [];
      for (let i = 1; i < sorted.length; i += 1) {
        spacings.push(sorted[i].index - sorted[i - 1].index);
      }
      const averageSpacing = spacings.length
        ? spacings.reduce((acc, item) => acc + item, 0) / spacings.length
        : 1;
      const sampleLines = sorted.slice(0, 5).map((r) => r.line);
      const columnHints = sorted.slice(0, 3).flatMap((row) => inferColumnHints(row.line, row.index));
      return {
        id: group.id,
        firstLineIndex: sorted[0].index,
        sampleLines,
        averageSpacing,
        columnHints,
        lineCount: sorted.length,
      } as RowCluster;
    })
    .sort((a, b) => a.firstLineIndex - b.firstLineIndex);
}

export function harvestStatementCandidates(fullText: string): {
  fields: Record<string, string[]>;
  txLines: string[];
  rowClusters: RowCluster[];
  columnHints: ColumnBoundaryHint[];
} {
  const fields: Record<string, string[]> = { bank_name: [], account_number: [], account_type: [], account_holder: [] };
  const lines = fullText.split(/\n/).map((s) => normaliseWhitespace(s)).filter(Boolean);
  lines.forEach((l) => {
    if (/statement/i.test(l)) fields.bank_name.push(l);
    if (/sort\s*code/i.test(l) || /account\s*number/i.test(l) || /iban/i.test(l)) fields.account_number.push(l);
    if (/current|checking|savings/i.test(l)) fields.account_type.push(l);
    if (/account holder|name|customer/i.test(l)) fields.account_holder.push(l);
  });
  const txLines = lines.filter((l) => DATE_PAT.some((rx) => rx.test(l)) && MONEY_PAT.test(l));
  const rowClusters = buildRowClusters(lines);
  const columnHints = rowClusters.flatMap((cluster) => cluster.columnHints);
  return { fields, txLines, rowClusters, columnHints };
}

export function derivePeriodFromTxIso(dates: string[]): { start?: string | null; end?: string | null } {
  const iso = dates.filter(Boolean).sort();
  return { start: iso[0] ?? null, end: iso[iso.length - 1] ?? null };
}
