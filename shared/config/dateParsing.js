'use strict';

const pathPreference = () => {
  const raw = process.env.DATE_PARSE_PREFERENCE || process.env.DATE_PARSE_ORDER || 'DMY';
  const upper = String(raw).trim().toUpperCase();
  return upper === 'MDY' ? 'MDY' : 'DMY';
};

function getDateParsePreference() {
  return pathPreference();
}

const MONTHS = new Map([
  ['JAN', '01'], ['JANUARY', '01'], ['FEB', '02'], ['FEBRUARY', '02'], ['MAR', '03'], ['MARCH', '03'],
  ['APR', '04'], ['APRIL', '04'], ['MAY', '05'], ['JUN', '06'], ['JUNE', '06'], ['JUL', '07'], ['JULY', '07'],
  ['AUG', '08'], ['AUGUST', '08'], ['SEP', '09'], ['SEPT', '09'], ['SEPTEMBER', '09'], ['OCT', '10'],
  ['OCTOBER', '10'], ['NOV', '11'], ['NOVEMBER', '11'], ['DEC', '12'], ['DECEMBER', '12'],
]);

function normaliseYear(token) {
  if (!token) return null;
  const trimmed = String(token).trim();
  if (!trimmed) return null;
  if (/^\d{4}$/.test(trimmed)) return trimmed;
  if (!/^\d{2}$/.test(trimmed)) return null;
  const year = Number.parseInt(trimmed, 10);
  if (Number.isNaN(year)) return null;
  // Assume 2000-2099 for 00-49, 1900-1999 for 50-99 to avoid future centuries.
  return year >= 50 ? `19${trimmed}` : `20${trimmed.padStart(2, '0')}`;
}

function isValidDay(day) {
  const num = Number.parseInt(day, 10);
  return Number.isInteger(num) && num >= 1 && num <= 31;
}

function isValidMonth(month) {
  const num = Number.parseInt(month, 10);
  return Number.isInteger(num) && num >= 1 && num <= 12;
}

function getDefaultDay() {
  const raw = process.env.DATE_PARSE_DEFAULT_DAY;
  const trimmed = raw == null ? '' : String(raw).trim();
  if (!trimmed) return '01';
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || !isValidDay(parsed)) return '01';
  return String(parsed).padStart(2, '0');
}

function buildIso(year, month, day) {
  if (!year || !month || !day) return null;
  if (!isValidMonth(month) || !isValidDay(day)) return null;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return iso;
}

function parseNumericDate(tokens, preference) {
  if (tokens.length !== 3) return null;
  const [aRaw, bRaw, cRaw] = tokens;
  // If first token has 4 digits treat as year-first ISO style.
  if (/^\d{4}$/.test(aRaw)) {
    return buildIso(aRaw, bRaw, cRaw);
  }
  // If last token has 4 digits treat as year-last.
  const year = normaliseYear(cRaw);
  if (!year) return null;
  let first = Number.parseInt(aRaw, 10);
  let second = Number.parseInt(bRaw, 10);
  if (!Number.isInteger(first) || !Number.isInteger(second)) return null;
  let day;
  let month;
  if (first > 12 && second <= 12) {
    day = first;
    month = second;
  } else if (second > 12 && first <= 12) {
    day = second;
    month = first;
  } else if (preference === 'MDY') {
    month = first;
    day = second;
  } else {
    day = first;
    month = second;
  }
  return buildIso(year, month, day);
}

function parseTextualDate(parts) {
  const cleaned = parts.map((token) => token.replace(/(st|nd|rd|th)$/i, ''));
  if (cleaned.length < 2 || cleaned.length > 3) return null;
  const upperParts = cleaned.map((token) => token.toUpperCase());
  let monthIndex = upperParts.findIndex((token) => MONTHS.has(token));
  if (monthIndex === -1) return null;
  const month = MONTHS.get(upperParts[monthIndex]);
  const remaining = cleaned.filter((_, idx) => idx !== monthIndex);
  if (remaining.length < 1) return null;
  if (remaining.length === 1) {
    const [candidate] = remaining;
    if (!/^\d{2,4}$/.test(candidate)) return null;
    if (/^\d{1,2}$/.test(candidate) && Number.parseInt(candidate, 10) <= 31) return null;
    const yearOnly = normaliseYear(candidate);
    if (!yearOnly) return null;
    return buildIso(yearOnly, month, getDefaultDay());
  }

  const yearIndexFourDigit = remaining.findIndex((token) => /^\d{4}$/.test(token));
  let yearIndex = yearIndexFourDigit;
  if (yearIndex === -1) {
    yearIndex = remaining.findIndex((token, idx) => {
      if (!/^\d{2}$/.test(token)) return false;
      return remaining.some((other, otherIdx) => {
        if (otherIdx === idx || !/^\d+$/.test(other)) return false;
        return isValidDay(other);
      });
    });
  }
  if (yearIndex === -1) return null;
  const year = normaliseYear(remaining[yearIndex]);
  if (!year) return null;

  let day = null;
  for (let i = 0; i < remaining.length; i += 1) {
    if (i === yearIndex) continue;
    const token = remaining[i];
    if (!/^\d+$/.test(token)) continue;
    if (isValidDay(token)) {
      day = token;
      break;
    }
  }
  if (!day) return null;
  return buildIso(year, month, day);
}

function parseDateString(value, preference = getDateParsePreference()) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalised = raw.replace(/[,]+/g, ' ').replace(/\s+/g, ' ').trim();
  const isoMatch = normalised.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})$/);
  if (isoMatch) {
    return buildIso(isoMatch[1], isoMatch[2], isoMatch[3]);
  }
  const numericMatch = normalised.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (numericMatch) {
    return parseNumericDate(numericMatch.slice(1), preference);
  }
  const tokens = normalised.split(' ');
  const textual = parseTextualDate(tokens);
  if (textual) return textual;
  return null;
}

module.exports = {
  getDateParsePreference,
  parseDateString,
};
