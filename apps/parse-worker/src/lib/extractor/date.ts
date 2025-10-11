import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import advancedFormat from 'dayjs/plugin/advancedFormat';
import { parseDateString } from '../../../../../shared/config/dateParsing';

dayjs.extend(customParseFormat);
dayjs.extend(advancedFormat);

type DateParts = { payDateMMYYYY?: string; periodStartMMYYYY?: string; periodEndMMYYYY?: string };

const SUPPORTED_FORMATS = [
  'DD/MM/YYYY',
  'MM/DD/YYYY',
  'YYYY-MM-DD',
  'DD MMM YYYY',
  'D MMM YYYY',
  'MMM YYYY',
  'MMMM YYYY',
  'DD.MM.YYYY',
  'DD MMMM YYYY',
  'D MMMM YYYY',
  'DD-MM-YYYY',
];

function toMonthYear(date: dayjs.Dayjs | null): string | undefined {
  if (!date || !date.isValid()) return undefined;
  return date.format('MM/YYYY');
}

function parseCandidate(value: string, hintYear?: number): dayjs.Dayjs | null {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  for (const format of SUPPORTED_FORMATS) {
    const parsed = dayjs(trimmed, format, true);
    if (parsed.isValid()) return parsed;
  }
  if (/^[A-Za-z]{3,9} \d{4}$/.test(trimmed)) {
    const parsed = dayjs(trimmed, 'MMM YYYY');
    if (parsed.isValid()) return parsed;
  }
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2}$/.test(trimmed)) {
    const parsed = dayjs(trimmed, 'DD/MM/YY');
    if (parsed.isValid()) return parsed;
  }
  if (hintYear && /^\d{1,2}[\/.\-]\d{1,2}$/.test(trimmed)) {
    const withYear = `${trimmed}/${hintYear}`;
    const parsed = dayjs(withYear, 'DD/MM/YYYY');
    if (parsed.isValid()) return parsed;
  }
  return null;
}

function extractYearHints(text: string): number[] {
  const matches = text.match(/\b(20\d{2}|19\d{2})\b/g) || [];
  return Array.from(new Set(matches.map((m) => Number.parseInt(m, 10))));
}

function pickClosestYear(years: number[]): number | undefined {
  if (!years.length) return undefined;
  return years.sort((a, b) => Math.abs(dayjs().year() - a) - Math.abs(dayjs().year() - b))[0];
}

export function normaliseDates(text: string): DateParts {
  if (!text?.trim()) return {};
  const cleaned = text.replace(/\u00A0/g, ' ');
  const years = extractYearHints(cleaned);
  const hintYear = pickClosestYear(years);

  const periodRegex = /(period|pay\s*period)[:\s-]*([\dA-Za-z\/.\- ]+)\s*(?:to|-)\s*([\dA-Za-z\/.\- ]{4,})/i;
  const periodMatch = cleaned.match(periodRegex);
  const result: DateParts = {};
  if (periodMatch) {
    const start = parseCandidate(periodMatch[2], hintYear);
    const end = parseCandidate(periodMatch[3], hintYear || start?.year());
    const startFmt = toMonthYear(start);
    const endFmt = toMonthYear(end);
    if (startFmt) result.periodStartMMYYYY = startFmt;
    if (endFmt) result.periodEndMMYYYY = endFmt;
  }

  const payDateRegex = /(pay\s*(date|period end|period ending))[:\s-]*([\dA-Za-z\/.\- ]{4,})/i;
  const payDateMatch = cleaned.match(payDateRegex);
  if (payDateMatch) {
    const pay = parseCandidate(payDateMatch[3], hintYear);
    const formatted = toMonthYear(pay);
    if (formatted) result.payDateMMYYYY = formatted;
  }

  if (!result.payDateMMYYYY || (!result.periodStartMMYYYY && !result.periodEndMMYYYY)) {
    const allDates = Array.from(
      cleaned.matchAll(/\b(?:\d{1,2}[\/.\-]){2}\d{2,4}\b|\b[A-Za-z]{3,9}\s+\d{4}\b/g)
    );
    for (const match of allDates) {
      const iso = parseDateString(match[0]);
      let parsed: dayjs.Dayjs | null = null;
      if (iso) {
        parsed = dayjs(iso);
      } else {
        parsed = parseCandidate(match[0], hintYear);
      }
      if (!parsed || !parsed.isValid()) continue;
      const formatted = toMonthYear(parsed);
      if (!formatted) continue;
      if (!result.payDateMMYYYY) {
        result.payDateMMYYYY = formatted;
        continue;
      }
      if (!result.periodEndMMYYYY) {
        result.periodEndMMYYYY = formatted;
      }
    }
  }

  if (!result.payDateMMYYYY && result.periodEndMMYYYY) {
    result.payDateMMYYYY = result.periodEndMMYYYY;
  }

  return result;
}

export default normaliseDates;
