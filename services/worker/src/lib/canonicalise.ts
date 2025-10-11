const INSTITUTION_ALIASES = new Map<string, string>(
  [
    ['MONZO BANK LTD', 'Monzo'],
    ['MONZO', 'Monzo'],
    ['HALIFAX PLC', 'Halifax'],
    ['THE VANGUARD GROUP', 'Vanguard'],
    ['VANGUARD UK', 'Vanguard'],
    ['BARCLAYS BANK UK PLC', 'Barclays'],
    ['HSBC UK BANK PLC', 'HSBC'],
  ].map(([raw, canonical]) => [raw.toLowerCase(), canonical])
);

export function canonicaliseInstitution(name: string | null | undefined): { canonical: string | null; raw: string | null } {
  if (!name) {
    return { canonical: null, raw: null };
  }
  const raw = String(name).trim();
  if (!raw) {
    return { canonical: null, raw: null };
  }
  const lookup = INSTITUTION_ALIASES.get(raw.toLowerCase());
  return { canonical: lookup ?? raw, raw };
}

export function canonicaliseEmployer(name: string | null | undefined): string | null {
  if (!name) {
    return null;
  }
  const trimmed = String(name).trim();
  return trimmed || null;
}
