import * as chrono from 'chrono-node';
import { z } from 'zod';
import { chunkLines, dedupe, normaliseWhitespace, parseNumberStrict, formatMonthYear } from './utils';
import { ExtractedFieldValue, ExtractFieldsResult, UserFieldRule, UserRuleSet } from './types';

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
  return result.data;
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

function applyRule(field: string, rule: UserFieldRule, lines: string[]): { value: string | number | null; issue?: string } {
  switch (rule.strategy) {
    case 'anchor+regex': {
      const index = findLineIndex(lines, rule.anchor);
      if (index === -1) {
        return { value: null, issue: `Anchor "${rule.anchor}" not found for ${field}` };
      }
      const targetLine = lines[index];
      const pattern = createCaseInsensitiveRegex(rule.regex);
      const match = pattern.exec(targetLine);
      if (!match) {
        return { value: null, issue: `Regex ${rule.regex} did not match for ${field}` };
      }
      const raw = match[1] || match[0];
      return enforceType(rule.expectedType, raw);
    }
    case 'line-offset': {
      const index = findLineIndex(lines, rule.anchor);
      if (index === -1) {
        return { value: null, issue: `Anchor "${rule.anchor}" not found for ${field}` };
      }
      const targetIndex = index + rule.lineOffset;
      if (targetIndex < 0 || targetIndex >= lines.length) {
        return { value: null, issue: `Offset ${rule.lineOffset} out of bounds for ${field}` };
      }
      const raw = lines[targetIndex];
      return enforceType(rule.expectedType, raw);
    }
    case 'box': {
      return { value: null, issue: `Box strategy not supported in text worker for ${field}` };
    }
    default:
      return { value: null, issue: `Unknown strategy for ${field}` };
  }
}

function runRuleExtraction(lines: string[], rules: UserRuleSet | null): ExtractFieldsResult {
  const values: Record<string, ExtractedFieldValue> = {};
  const issues: string[] = [];
  const usedRuleFields: string[] = [];
  if (!rules) {
    return { values, issues, usedRuleFields };
  }
  Object.entries(rules).forEach(([field, rule]) => {
    const applied = applyRule(field, rule, lines);
    if (applied.issue) {
      issues.push(applied.issue);
      values[field] = { field, source: 'rule', value: null, detail: applied.issue };
      return;
    }
    usedRuleFields.push(field);
    values[field] = { field, source: 'rule', value: applied.value };
  });
  return { values, issues, usedRuleFields };
}

function locateNumberByKeywords(lines: string[], keywords: string[]): number | null {
  const keywordRegex = new RegExp(keywords.join('|'), 'i');
  for (const line of lines) {
    if (keywordRegex.test(line) && !/\bYTD\b/i.test(line)) {
      const match = line.match(/-?[£$€]?[\d,.()]+/g);
      if (!match) continue;
      const candidates = match
        .map((token) => parseNumberStrict(token))
        .filter((value): value is number => value !== null);
      if (candidates.length === 0) continue;
      return candidates[candidates.length - 1];
    }
  }
  return null;
}

function buildHeuristicValues(lines: string[], docType: string): Record<string, ExtractedFieldValue> {
  const values: Record<string, ExtractedFieldValue> = {};
  const upperDocType = docType.toUpperCase();
  if (upperDocType.includes('PAYSLIP')) {
    const gross = locateNumberByKeywords(lines, ['gross', 'total\s+earnings']);
    if (gross !== null) {
      values.grossPay = { field: 'grossPay', source: 'heuristic', value: gross };
    }
    const net = locateNumberByKeywords(lines, ['net\s+pay', 'take\s*home']);
    if (net !== null) {
      values.netPay = { field: 'netPay', source: 'heuristic', value: net };
    }
    const deductions = locateNumberByKeywords(lines, ['total\s+deductions', 'deductions\s+total']);
    if (deductions !== null) {
      values.totalDeductions = { field: 'totalDeductions', source: 'heuristic', value: deductions };
    }
  }
  if (upperDocType.includes('STATEMENT')) {
    const closing = locateNumberByKeywords(lines, ['closing\s+balance']);
    if (closing !== null) {
      values.closingBalance = { field: 'closingBalance', source: 'heuristic', value: closing };
    }
    const opening = locateNumberByKeywords(lines, ['opening\s+balance']);
    if (opening !== null) {
      values.openingBalance = { field: 'openingBalance', source: 'heuristic', value: opening };
    }
  }
  return values;
}

export function extractFields(text: string, docType: string, userRulesRaw?: unknown): ExtractFieldsResult {
  const normalised = normaliseWhitespace(text);
  const lines = chunkLines(normalised);
  const rules = validateRules(userRulesRaw);
  const ruleExtraction = runRuleExtraction(lines, rules);
  const heuristics = buildHeuristicValues(lines, docType);
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
