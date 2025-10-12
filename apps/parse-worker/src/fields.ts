import * as chrono from 'chrono-node';
import { z } from 'zod';
import { chunkLines, dedupe, parseNumberStrict, formatMonthYear, normaliseWhitespace } from './utils';
import {
  BoundingBox,
  ExtractedFieldValue,
  ExtractedTextContent,
  ExtractFieldsResult,
  FieldPosition,
  LineGeometry,
  UserFieldRule,
  UserRuleSet,
  BoxRule,
} from './types';

const BaseRuleSchema = z.object({
  expectedType: z.enum(['number', 'string', 'date']),
  label: z.string().optional(),
});

const AnchorRegexRuleSchema = BaseRuleSchema.extend({
  strategy: z.literal('anchor+regex'),
  anchor: z.string().min(1),
  regex: z.string().min(1),
});

const LineOffsetRuleSchema = BaseRuleSchema.extend({
  strategy: z.literal('line-offset'),
  anchor: z.string().min(1),
  lineOffset: z.number().int(),
});

const BoxRuleSchema = BaseRuleSchema.extend({
  strategy: z.literal('box'),
  top: z.number(),
  left: z.number(),
  width: z.number(),
  height: z.number(),
});

const RuleSchema = z.discriminatedUnion('strategy', [AnchorRegexRuleSchema, LineOffsetRuleSchema, BoxRuleSchema]);

const RuleSetSchema = z.record(RuleSchema);

function validateRules(rules: unknown): UserRuleSet | null {
  if (!rules) return null;
  const result = RuleSetSchema.safeParse(rules);
  if (!result.success) {
    console.warn('[parse-worker] invalid user rules', result.error.issues);
    return null;
  }
  return result.data as UserRuleSet;
}

function createCaseInsensitiveRegex(pattern: string): RegExp {
  try {
    return new RegExp(pattern, 'i');
  } catch (err) {
    return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }
}

function findLineIndex(lines: string[], anchor: string): number {
  const anchorRegex = createCaseInsensitiveRegex(anchor);
  return lines.findIndex((line) => anchorRegex.test(line));
}

interface ExtractionContext {
  lines: string[];
  geometry: Map<number, LineGeometry>;
  geometryList: LineGeometry[];
}

function createContext(extracted: ExtractedTextContent): ExtractionContext {
  const geometry = new Map<number, LineGeometry>();
  extracted.geometry.forEach((line) => {
    geometry.set(line.lineIndex, line);
  });
  return {
    lines: extracted.lines,
    geometry,
    geometryList: extracted.geometry,
  };
}

function getLineGeometry(context: ExtractionContext, index: number): LineGeometry | undefined {
  return context.geometry.get(index);
}

function buildPosition(
  context: ExtractionContext,
  lineIndex: number,
  charStart: number,
  length: number
): FieldPosition | null {
  if (lineIndex < 0) return null;
  const charEnd = Math.max(charStart + length, charStart);
  const line = getLineGeometry(context, lineIndex);
  if (!line) {
    return {
      lineIndex,
      charStart,
      charEnd,
    };
  }
  const boxes = line.segments
    .filter((segment) => segment.charEnd > charStart && segment.charStart < charEnd)
    .map((segment) => segment.box);
  return {
    lineIndex,
    charStart,
    charEnd,
    pageNumber: line.pageNumber,
    boxes: boxes.length ? boxes : undefined,
  };
}

function boxesIntersect(a: BoundingBox, b: BoxRule): boolean {
  const ax2 = a.left + a.width;
  const ay2 = a.top + a.height;
  const bx2 = b.left + b.width;
  const by2 = b.top + b.height;
  return a.left < bx2 && ax2 > b.left && a.top < by2 && ay2 > b.top;
}

function collectTextFromBox(
  context: ExtractionContext,
  rule: BoxRule
): { raw: string; positions: FieldPosition[] } | null {
  const perLine = new Map<number, Array<{ start: number; end: number }>>();
  context.geometryList.forEach((line) => {
    if (!line.bounds || !boxesIntersect(line.bounds, rule)) return;
    const relevant = line.segments.filter((segment) => boxesIntersect(segment.box, rule));
    if (!relevant.length) return;
    relevant.sort((a, b) => a.charStart - b.charStart);
    const merged: Array<{ start: number; end: number }> = [];
    relevant.forEach((segment) => {
      const target = { start: segment.charStart, end: segment.charEnd };
      const last = merged[merged.length - 1];
      if (last && target.start <= last.end) {
        last.end = Math.max(last.end, target.end);
      } else {
        merged.push(target);
      }
    });
    perLine.set(line.lineIndex, merged);
  });

  if (!perLine.size) return null;

  const sortedLines = Array.from(perLine.entries()).sort((a, b) => a[0] - b[0]);
  const rawLines: string[] = [];
  const positions: FieldPosition[] = [];

  sortedLines.forEach(([lineIndex, ranges]) => {
    const lineText = context.lines[lineIndex] || '';
    const fragments: string[] = [];
    ranges.forEach((range) => {
      const fragment = lineText.slice(range.start, range.end);
      if (!fragment.trim()) return;
      fragments.push(fragment);
      const position = buildPosition(context, lineIndex, range.start, range.end - range.start);
      if (position) {
        positions.push(position);
      }
    });
    if (fragments.length) {
      rawLines.push(fragments.join(' '));
    }
  });

  if (!rawLines.length) return null;
  const raw = rawLines.join('\n').trim();
  if (!raw) return null;
  return { raw, positions };
}

function enforceType(expected: 'number' | 'string' | 'date', raw: string | null): { value: string | number | null; issue?: string } {
  if (!raw) return { value: null };
  if (expected === 'number') {
    const parsed = parseNumberStrict(raw);
    if (parsed === null) {
      return { value: null, issue: `Expected number, got ${raw}` };
    }
    return { value: parsed };
  }
  if (expected === 'date') {
    const parsed = chrono.parseDate(raw, new Date(), { forwardDate: true });
    if (!parsed) {
      return { value: null, issue: `Expected date, got ${raw}` };
    }
    return { value: formatMonthYear(parsed) };
  }
  return { value: normaliseWhitespace(raw) };
}

function applyRule(field: string, rule: UserFieldRule, context: ExtractionContext): ExtractedFieldValue {
  const lines = context.lines;
  switch (rule.strategy) {
    case 'anchor+regex': {
      const index = findLineIndex(lines, rule.anchor);
      if (index === -1) {
        const detail = `Anchor "${rule.anchor}" not found for ${field}`;
        return { field, source: 'rule', value: null, detail };
      }
      const targetLine = lines[index];
      const pattern = createCaseInsensitiveRegex(rule.regex);
      const match = pattern.exec(targetLine);
      if (!match) {
        const detail = `Regex ${rule.regex} did not match for ${field}`;
        return { field, source: 'rule', value: null, detail };
      }
      const captured = match[1] || match[0];
      let charStart = match.index ?? targetLine.indexOf(captured);
      if (match[1]) {
        const offsetWithin = match[0].indexOf(captured);
        if (offsetWithin >= 0 && match.index != null) {
          charStart = match.index + offsetWithin;
        }
      }
      if (charStart < 0) {
        charStart = 0;
      }
      const typed = enforceType(rule.expectedType, captured);
      if (typed.issue) {
        return { field, source: 'rule', value: null, detail: typed.issue };
      }
      const position = buildPosition(context, index, charStart, captured.length);
      return {
        field,
        source: 'rule',
        value: typed.value,
        positions: position ? [position] : undefined,
      };
    }
    case 'line-offset': {
      const index = findLineIndex(lines, rule.anchor);
      if (index === -1) {
        const detail = `Anchor "${rule.anchor}" not found for ${field}`;
        return { field, source: 'rule', value: null, detail };
      }
      const targetIndex = index + rule.lineOffset;
      if (targetIndex < 0 || targetIndex >= lines.length) {
        const detail = `Offset ${rule.lineOffset} out of bounds for ${field}`;
        return { field, source: 'rule', value: null, detail };
      }
      const raw = lines[targetIndex];
      const typed = enforceType(rule.expectedType, raw);
      if (typed.issue) {
        return { field, source: 'rule', value: null, detail: typed.issue };
      }
      const position = buildPosition(context, targetIndex, 0, raw.length);
      return {
        field,
        source: 'rule',
        value: typed.value,
        positions: position ? [position] : undefined,
      };
    }
    case 'box': {
      const collected = collectTextFromBox(context, rule);
      if (!collected) {
        const detail = `No text located for box rule on ${field}`;
        return { field, source: 'rule', value: null, detail };
      }
      const typed = enforceType(rule.expectedType, collected.raw);
      if (typed.issue) {
        return { field, source: 'rule', value: null, detail: typed.issue };
      }
      return {
        field,
        source: 'rule',
        value: typed.value,
        positions: collected.positions.length ? collected.positions : undefined,
      };
    }
    default: {
      const detail = `Unknown strategy for ${field}`;
      return { field, source: 'rule', value: null, detail };
    }
  }
}

function runRuleExtraction(context: ExtractionContext, rules: UserRuleSet | null): ExtractFieldsResult {
  const values: Record<string, ExtractedFieldValue> = {};
  const issues: string[] = [];
  const usedRuleFields: string[] = [];
  if (!rules) {
    return { values, issues, usedRuleFields };
  }
  Object.entries(rules).forEach(([field, rule]) => {
    const applied = applyRule(field, rule, context);
    if (applied.detail && applied.value == null) {
      issues.push(applied.detail);
    }
    if (!applied.detail) {
      usedRuleFields.push(field);
    }
    values[field] = applied;
  });
  return { values, issues, usedRuleFields };
}

function locateNumberByKeywords(
  context: ExtractionContext,
  keywords: string[]
): { value: number; lineIndex: number; charStart: number; charEnd: number } | null {
  const { lines } = context;
  const keywordRegex = new RegExp(keywords.join('|'), 'i');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (keywordRegex.test(line) && !/\bYTD\b/i.test(line)) {
      const numberPattern = /-?[£$€]?[\d,.()]+/g;
      let match: RegExpExecArray | null = null;
      let candidate: { value: number; lineIndex: number; charStart: number; charEnd: number } | null = null;
      while ((match = numberPattern.exec(line))) {
        const parsed = parseNumberStrict(match[0]);
        if (parsed === null) continue;
        candidate = {
          value: parsed,
          lineIndex: index,
          charStart: match.index,
          charEnd: match.index + match[0].length,
        };
      }
      if (candidate) return candidate;
    }
  }
  return null;
}

function buildHeuristicValues(context: ExtractionContext, docType: string): Record<string, ExtractedFieldValue> {
  const values: Record<string, ExtractedFieldValue> = {};
  const upperDocType = docType.toUpperCase();
  if (upperDocType.includes('PAYSLIP')) {
    const gross = locateNumberByKeywords(context, ['gross', 'total\s+earnings']);
    if (gross !== null) {
      const position = buildPosition(context, gross.lineIndex, gross.charStart, gross.charEnd - gross.charStart);
      values.grossPay = {
        field: 'grossPay',
        source: 'heuristic',
        value: gross.value,
        positions: position ? [position] : undefined,
      };
    }
    const net = locateNumberByKeywords(context, ['net\s+pay', 'take\s*home']);
    if (net !== null) {
      const position = buildPosition(context, net.lineIndex, net.charStart, net.charEnd - net.charStart);
      values.netPay = {
        field: 'netPay',
        source: 'heuristic',
        value: net.value,
        positions: position ? [position] : undefined,
      };
    }
    const deductions = locateNumberByKeywords(context, ['total\s+deductions', 'deductions\s+total']);
    if (deductions !== null) {
      const position = buildPosition(
        context,
        deductions.lineIndex,
        deductions.charStart,
        deductions.charEnd - deductions.charStart
      );
      values.totalDeductions = {
        field: 'totalDeductions',
        source: 'heuristic',
        value: deductions.value,
        positions: position ? [position] : undefined,
      };
    }
  }
  if (upperDocType.includes('STATEMENT')) {
    const closing = locateNumberByKeywords(context, ['closing\s+balance']);
    if (closing !== null) {
      const position = buildPosition(context, closing.lineIndex, closing.charStart, closing.charEnd - closing.charStart);
      values.closingBalance = {
        field: 'closingBalance',
        source: 'heuristic',
        value: closing.value,
        positions: position ? [position] : undefined,
      };
    }
    const opening = locateNumberByKeywords(context, ['opening\s+balance']);
    if (opening !== null) {
      const position = buildPosition(context, opening.lineIndex, opening.charStart, opening.charEnd - opening.charStart);
      values.openingBalance = {
        field: 'openingBalance',
        source: 'heuristic',
        value: opening.value,
        positions: position ? [position] : undefined,
      };
    }
  }
  return values;
}

export function extractFields(extracted: ExtractedTextContent, docType: string, userRulesRaw?: unknown): ExtractFieldsResult {
  const context = createContext(extracted);
  const rules = validateRules(userRulesRaw);
  const ruleExtraction = runRuleExtraction(context, rules);
  const heuristics = buildHeuristicValues(context, docType);
  const mergedValues: Record<string, ExtractedFieldValue> = { ...heuristics, ...ruleExtraction.values };
  return {
    values: mergedValues,
    issues: ruleExtraction.issues,
    usedRuleFields: ruleExtraction.usedRuleFields,
  };
}

const COMMON_ANCHORS = [
  'Pay Date',
  'Pay Period',
  'Period Start',
  'Period End',
  'Gross Pay',
  'Net Pay',
  'Total Deductions',
  'Earnings',
  'Deductions',
  'YTD',
  'Employee Name',
  'Employer',
];

export function suggestAnchors(text: string): string[] {
  const lines = chunkLines(text);
  const colonAnchors = lines
    .filter((line) => line.includes(':'))
    .map((line) => line.split(':')[0].trim())
    .filter((token) => token.length > 3);
  return dedupe([...COMMON_ANCHORS, ...colonAnchors]).slice(0, 50);
}

export function parseUserRules(raw: string | null): UserRuleSet | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return validateRules(parsed);
  } catch (err) {
    console.warn('[parse-worker] unable to parse user rules JSON', err);
    return null;
  }
}
