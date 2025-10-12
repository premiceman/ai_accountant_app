const DATE_PAT = [
  /\b\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\,?\s+\d{2,4}\b/gi,
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\b\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}\b/g
];
const SCAN_HEADERS = [/statement period/i, /closing balance/i, /sort code/i, /account number/i, /iban/i];

export type Tx = { date?: string; description?: string; amount?: string };
export function harvestStatementCandidates(fullText: string): { fields: Record<string,string[]>; txLines: string[] } {
  const fields: Record<string,string[]> = { bank_name: [], account_number: [], account_type: [], account_holder: [] };
  const lines = fullText.split(/\n/).map(s=>s.trim()).filter(Boolean);
  lines.forEach(l => {
    if (/statement/i.test(l)) fields.bank_name.push(l);
    if (/sort\s*code/i.test(l) || /account\s*number/i.test(l) || /iban/i.test(l)) fields.account_number.push(l);
    if (/current|checking|savings/i.test(l)) fields.account_type.push(l);
    if (/account holder|name|customer/i.test(l)) fields.account_holder.push(l);
  });
  // tx candidate lines look like: date ... description ... amount
  const txLines = lines.filter(l => DATE_PAT.some(rx => rx.test(l)) && /[-+£$€(]\d/.test(l));
  return { fields, txLines };
}

export function derivePeriodFromTxIso(dates: string[]): { start?: string|null; end?: string|null } {
  const iso = dates.filter(Boolean).sort();
  return { start: iso[0] ?? null, end: iso[iso.length-1] ?? null };
}
