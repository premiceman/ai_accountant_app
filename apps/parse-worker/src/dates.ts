import * as chrono from 'chrono-node';
import { chunkLines, clamp, formatMonthYear } from './utils';

interface ChronoParseResult {
  text: string;
  start?: {
    date(): Date | null;
  };
}

interface DateCandidate {
  normalized: string;
  raw: string;
  date: Date;
  lineIndex: number;
  tags: Set<AnchorTag>;
  confidence: number;
  source: 'regex' | 'chrono';
}

type AnchorTag = 'payDate' | 'periodStart' | 'periodEnd' | 'period' | 'generic';

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
  'jan',
  'feb',
  'mar',
  'apr',
  'jun',
  'jul',
  'aug',
  'sep',
  'sept',
  'oct',
  'nov',
  'dec',
];

const TEXTUAL_PATTERN = new RegExp(
  `(\\b(?:${MONTH_NAMES.join('|')})\\b)[\\s-]*(\\d{1,2})?,?[\\s-]*(\\d{2,4})`,
  'gi'
);

const YYYY_MM_DD = /(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/g;
const DD_MM_YYYY = /(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/g;

const ANCHORS: Array<{ tag: AnchorTag; weight: number; pattern: RegExp }> = [
  { tag: 'payDate', weight: 0.45, pattern: /pay\s*(date|day)/i },
  { tag: 'payDate', weight: 0.4, pattern: /payment\s*date/i },
  { tag: 'periodStart', weight: 0.35, pattern: /(period|pay)\s*start/i },
  { tag: 'periodEnd', weight: 0.35, pattern: /(period|pay)\s*(end|ending)/i },
  { tag: 'period', weight: 0.25, pattern: /pay\s*period/i },
  { tag: 'period', weight: 0.25, pattern: /period\s*covered/i },
  { tag: 'generic', weight: 0.1, pattern: /date[:\s]/i },
  { tag: 'generic', weight: 0.1, pattern: /(period|statement)\s*:?/i },
];

const BASE_CONFIDENCE = {
  regex: 0.5,
  chrono: 0.35,
} as const;

function inferYear(yearRaw: string): number {
  const year = Number.parseInt(yearRaw, 10);
  if (year < 100) {
    const now = new Date();
    const currentCentury = Math.floor(now.getFullYear() / 100) * 100;
    return currentCentury + year;
  }
  return year;
}

function buildCandidate(options: {
  raw: string;
  lineIndex: number;
  month: number;
  day: number;
  year: number;
  tags: Set<AnchorTag>;
  source: 'regex' | 'chrono';
}): DateCandidate | null {
  const { month, day, year } = options;
  if (!month || !year) return null;
  const safeDay = Number.isFinite(day) && day > 0 ? day : 1;
  const date = new Date(year, month - 1, safeDay);
  if (!Number.isFinite(date.valueOf())) return null;
  const normalized = formatMonthYear(date);
  return {
    normalized,
    raw: options.raw,
    date,
    lineIndex: options.lineIndex,
    tags: options.tags,
    confidence: clamp(BASE_CONFIDENCE[options.source] + scoreAnchors(options.tags), 0, 1),
    source: options.source,
  };
}

function scoreAnchors(tags: Set<AnchorTag>): number {
  let score = 0;
  for (const anchor of ANCHORS) {
    if (tags.has(anchor.tag)) {
      score += anchor.weight;
    }
  }
  return score;
}

function detectAnchors(line: string): Set<AnchorTag> {
  const tags = new Set<AnchorTag>();
  for (const anchor of ANCHORS) {
    if (anchor.pattern.test(line)) {
      tags.add(anchor.tag);
    }
  }
  return tags;
}

function collectRegex(line: string, lineIndex: number, tags: Set<AnchorTag>): DateCandidate[] {
  const candidates: DateCandidate[] = [];
  for (const regex of [YYYY_MM_DD, DD_MM_YYYY]) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(line))) {
      const [raw, a, b, c] = match;
      if (regex === YYYY_MM_DD) {
        const year = Number.parseInt(a, 10);
        const month = Number.parseInt(b, 10);
        const day = Number.parseInt(c, 10);
        const candidate = buildCandidate({ raw, lineIndex, month, day, year, tags, source: 'regex' });
        if (candidate) candidates.push(candidate);
      } else {
        const day = Number.parseInt(a, 10);
        const month = Number.parseInt(b, 10);
        const year = inferYear(c);
        const candidate = buildCandidate({ raw, lineIndex, month, day, year, tags, source: 'regex' });
        if (candidate) candidates.push(candidate);
      }
    }
  }

  TEXTUAL_PATTERN.lastIndex = 0;
  let textual: RegExpExecArray | null;
  while ((textual = TEXTUAL_PATTERN.exec(line))) {
    const raw = textual[0];
    const monthToken = textual[1];
    const dayToken = textual[2];
    const yearToken = textual[3];
    const month = MONTH_NAMES.indexOf(monthToken.toLowerCase()) % 12;
    const resolvedMonth = month >= 0 ? month + 1 : NaN;
    const year = inferYear(yearToken);
    const day = dayToken ? Number.parseInt(dayToken, 10) : 1;
    const candidate = buildCandidate({
      raw,
      lineIndex,
      month: resolvedMonth,
      day,
      year,
      tags,
      source: 'regex',
    });
    if (candidate) candidates.push(candidate);
  }

  return candidates;
}

function collectChrono(line: string, lineIndex: number, tags: Set<AnchorTag>): DateCandidate[] {
  if (tags.size === 0) return [];
  const parsed = chrono.parse(line, new Date(), { forwardDate: true }) as ChronoParseResult[];
  return parsed
    .map((result: ChronoParseResult) => {
      const date = result.start?.date();
      if (!date) return null;
      return buildCandidate({
        raw: result.text,
        lineIndex,
        month: date.getMonth() + 1,
        day: date.getDate(),
        year: date.getFullYear(),
        tags,
        source: 'chrono',
      });
    })
    .filter((candidate): candidate is DateCandidate => candidate !== null);
}

function pickCandidate(candidates: DateCandidate[], predicate: (candidate: DateCandidate) => boolean): DateCandidate | null {
  const filtered = candidates.filter(predicate);
  if (!filtered.length) return null;
  filtered.sort((a, b) => b.confidence - a.confidence || a.lineIndex - b.lineIndex);
  return filtered[0];
}

export interface DateExtractionResult {
  payDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  anchors: string[];
  confidence: number;
}

export function extractDates(text: string): DateExtractionResult {
  const lines = chunkLines(text);
  const candidates: DateCandidate[] = [];

  lines.forEach((line, index) => {
    const tags = detectAnchors(line);
    candidates.push(...collectRegex(line, index, tags));
    candidates.push(...collectChrono(line, index, tags));
  });

  const unique = new Map<string, DateCandidate>();
  candidates.forEach((candidate) => {
    const key = `${candidate.normalized}:${candidate.lineIndex}:${candidate.tags.size}`;
    if (!unique.has(key) || unique.get(key)!.confidence < candidate.confidence) {
      unique.set(key, candidate);
    }
  });

  const finalCandidates = Array.from(unique.values());

  const payDateCandidate =
    pickCandidate(finalCandidates, (candidate) => candidate.tags.has('payDate')) ||
    pickCandidate(finalCandidates, (candidate) => candidate.tags.has('period')) ||
    pickCandidate(finalCandidates, () => true);

  const periodStartCandidate =
    pickCandidate(finalCandidates, (candidate) => candidate.tags.has('periodStart')) ||
    pickCandidate(finalCandidates, (candidate) => candidate.tags.has('period')) ||
    null;

  const periodEndCandidate =
    pickCandidate(finalCandidates, (candidate) => candidate.tags.has('periodEnd')) ||
    pickCandidate(finalCandidates, (candidate) => candidate.tags.has('period')) ||
    null;

  const anchors = new Set<string>();
  if (payDateCandidate) payDateCandidate.tags.forEach((tag) => anchors.add(tag));
  if (periodStartCandidate) periodStartCandidate.tags.forEach((tag) => anchors.add(tag));
  if (periodEndCandidate) periodEndCandidate.tags.forEach((tag) => anchors.add(tag));

  const confidence = Math.max(
    payDateCandidate?.confidence ?? 0,
    periodStartCandidate?.confidence ?? 0,
    periodEndCandidate?.confidence ?? 0
  );

  return {
    payDate: payDateCandidate?.normalized ?? null,
    periodStart: periodStartCandidate?.normalized ?? null,
    periodEnd: periodEndCandidate?.normalized ?? null,
    anchors: Array.from(anchors),
    confidence,
  };
}
