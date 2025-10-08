const INSTITUTION_ALIASES = new Map(
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

function canonicaliseInstitution(name) {
  if (!name) return { canonical: null, raw: null };
  const raw = String(name).trim();
  if (!raw) return { canonical: null, raw: null };
  const lookup = INSTITUTION_ALIASES.get(raw.toLowerCase());
  return { canonical: lookup || raw, raw };
}

function canonicaliseEmployer(name) {
  if (!name) return null;
  return String(name).trim();
}

module.exports = { canonicaliseInstitution, canonicaliseEmployer };
