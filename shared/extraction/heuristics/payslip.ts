const DATE_PAT = [
  /\b\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\,?\s+\d{2,4}\b/gi,
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\b\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}\b/g,
  /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\b/gi
];
const MONEY_PAT = /(?:(?:£|\$|€)\s*)?-?\(?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})\)?\s*(CR|DR)?/g;
const LABEL_ALIASES = {
  employee: [/^employee\b/i, /^employee name\b/i, /^name\b/i],
  employer: [/^employer\b/i, /^company\b/i, /^organisation\b/i],
  payDate: [/^pay\s*date\b/i, /^date\s*paid\b/i, /^payment\s*date\b/i],
  payFreq: [/^pay\s*frequency\b/i, /^frequency\b/i],
  taxCode: [/^tax\s*code\b/i],
  niLetter: [/^(?:ni|national insurance)\s*(?:letter|cat(?:egory)?)\b/i],
  thisPeriod: [/^this\s*period\b/i, /^period\b/i, /^tp\b/i],
  thisYear: [/^(?:this\s*year|ytd|to\s*date)\b/i]
};
const toMinor = (s: string) => {
  const neg = /\(/.test(s) || /\bDR\b/i.test(s) || /^-/.test(s);
  const num = s.replace(/[^\d.,-]/g, '').replace(/,/g, '').replace(/(\d)\.(?=\d{3}\b)/g, '$1'); // 1.234,56 or 1,234.56 tolerant
  const n = parseFloat(num.replace(/,/, '.'));
  const minor = Math.round((isNaN(n) ? 0 : n) * 100);
  return neg ? -Math.abs(minor) : minor;
};

export type Candidate = { field: string; value: string; page?: number; line?: number; confidence: number; hint?: string; };

export function harvestPayslipCandidates(fullText: string): Record<string, Candidate[]> {
  const lines = fullText.split(/\n/);
  const C: Record<string, Candidate[]> = {};
  function push(field: string, value: string, i: number, j?: number, conf=0.7, hint?: string) {
    (C[field] ||= []).push({ field, value, page: undefined, line: i, confidence: conf, hint });
  }
  // Simple label matching
  lines.forEach((ln, i) => {
    const [label, val] = ln.split(/:\s*/);
    if (val) {
      Object.entries(LABEL_ALIASES).forEach(([key, regs]) => {
        if (regs.some(r => r.test(label))) {
          push(key, val.trim(), i, undefined, 0.9, 'label');
        }
      });
    }
    // Scan money tokens for TP/YTD sections
    if (LABEL_ALIASES.thisPeriod.some(r=>r.test(ln))) push('section_tp', '1', i, undefined, 0.6);
    if (LABEL_ALIASES.thisYear.some(r=>r.test(ln)))  push('section_ytd','1', i, undefined, 0.6);
  });
  // Dates anywhere
  DATE_PAT.forEach(rx => {
    for (const m of fullText.match(rx) || []) push('date_any', m, -1, -1, 0.5, 'date');
  });
  // Money anywhere (used as fallback)
  for (const m of fullText.match(MONEY_PAT) || []) push('money_any', m, -1, -1, 0.3);
  return C;
}
