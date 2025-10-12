import * as chrono from 'chrono-node';
import { z } from 'zod';
import { chunkLines, dedupe, normaliseWhitespace, parseNumberStrict, formatMonthYear } from './utils';
import {
  ExtractedFieldValue,
  ExtractFieldsResult,
  StatementColumnRule,
  StatementRowTemplate,
  StatementRules,
  UserFieldRule,
  UserRuleSet,
  UserSchematicRules,
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

const StatementColumnSchema = z.object({
  key: z.enum(['date', 'description', 'amount', 'ignore']).default('description'),
  regex: z.string().optional(),
  start: z.number().int().min(0).optional(),
  end: z.number().int().min(0).optional(),
});

const StatementTemplateSchema = z.object({
  id: z.string().optional(),
  label: z.string().optional(),
  startLine: z.number().int().min(0),
  lineStride: z.number().int().min(1).optional(),
  maxRows: z.number().int().min(1).optional(),
  stopRegex: z.string().optional(),
  columns: z.array(StatementColumnSchema).min(1),
});

const StatementRulesSchema = z.object({
  templates: z.array(StatementTemplateSchema).min(1),
});

const CompositeRuleSchema = z.object({
  fields: RuleSetSchema.optional(),
  statement: StatementRulesSchema.optional(),
});

function validateRules(rules: unknown): UserSchematicRules | null {
  if (!rules) return null;
  const composite = CompositeRuleSchema.safeParse(rules);
  if (composite.success) {
    return {
      fields: composite.data.fields ?? null,
      statement: composite.data.statement ?? null,
    };
  }
  const legacy = RuleSetSchema.safeParse(rules);
  if (legacy.success) {
    return { fields: legacy.data, statement: null };
  }
  console.warn('[parse-worker] invalid user rules', composite.error.issues);
  return null;
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

function runRuleExtraction(lines: string[], rules: UserRuleSet | null): Pick<ExtractFieldsResult, 'values' | 'issues' | 'usedRuleFields'> {
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

function clampRange(line: string, start?: number, end?: number): { start: number; end: number } {
  const len = line.length;
  const safeStart = typeof start === 'number' ? Math.max(0, Math.min(start, len)) : 0;
  const safeEnd = typeof end === 'number' ? Math.max(safeStart, Math.min(end, len)) : len;
  return { start: safeStart, end: safeEnd };
}

function extractColumnValue(line: string, column: StatementColumnRule): { value: string | null; issue?: string } {
  const { start, end } = clampRange(line, column.start, column.end);
  const segment = line.slice(start, end).trim() || line.trim();
  if (!segment) {
    return { value: null, issue: `No text available for ${column.key}` };
  }
  if (column.regex) {
    const pattern = createCaseInsensitiveRegex(column.regex);
    const match = pattern.exec(segment);
    if (!match) {
      return { value: null, issue: `Regex ${column.regex} did not match for ${column.key}` };
    }
    const raw = (match[1] ?? match[0])?.trim() ?? '';
    return { value: raw || null, issue: raw ? undefined : `Matched ${column.regex} but extracted empty value` };
  }
  return { value: segment };
}

function parseStatementDate(raw: string | null): string | null {
  if (!raw) return null;
  const parsed = chrono.parseDate(raw, new Date(), { forwardDate: true });
  if (!parsed) return null;
  return parsed.toISOString().slice(0, 10);
}

function parseStatementAmount(raw: string | null): number | null {
  if (!raw) return null;
  return parseNumberStrict(raw);
}

function applyStatementTemplate(lines: string[], template: StatementRowTemplate): {
  transactions: Array<{ date: string; description: string; amount: number }>;
  issues: string[];
} {
  const transactions: Array<{ date: string; description: string; amount: number }> = [];
  const issues: string[] = [];
  const stride = template.lineStride && template.lineStride > 0 ? template.lineStride : 1;
  const limit = template.maxRows && template.maxRows > 0 ? template.maxRows : Number.MAX_SAFE_INTEGER;
  const stopRegex = template.stopRegex ? createCaseInsensitiveRegex(template.stopRegex) : null;
  for (let step = 0; step < limit; step += 1) {
    const lineIndex = template.startLine + step * stride;
    if (lineIndex < 0 || lineIndex >= lines.length) break;
    const line = lines[lineIndex];
    if (!line || !line.trim()) {
      if (transactions.length === 0) continue;
      break;
    }
    if (stopRegex && stopRegex.test(line)) break;
    const extracted: Record<string, string | null> = {};
    let skip = false;
    for (const column of template.columns) {
      const { value, issue } = extractColumnValue(line, column);
      if (issue) {
        issues.push(`Line ${lineIndex + 1}: ${issue}`);
        if (transactions.length === 0) {
          skip = true;
          break;
        }
        skip = true;
        break;
      }
      if (column.key === 'ignore') continue;
      extracted[column.key] = value;
    }
    if (skip) {
      if (!transactions.length) break;
      continue;
    }
    const date = parseStatementDate(extracted.date ?? null);
    if (!date) {
      issues.push(`Line ${lineIndex + 1}: Unable to parse date`);
      if (!transactions.length) break;
      continue;
    }
    const amount = parseStatementAmount(extracted.amount ?? null);
    if (amount === null) {
      issues.push(`Line ${lineIndex + 1}: Unable to parse amount`);
      if (!transactions.length) break;
      continue;
    }
    const description = normaliseWhitespace(extracted.description ?? '') || 'Transaction';
    transactions.push({ date, description, amount });
  }
  return { transactions, issues };
}

function applyStatementRules(
  lines: string[],
  rules: StatementRules | null
): { transactions: Array<{ date: string; description: string; amount: number }>; issues: string[] } {
  if (!rules || !Array.isArray(rules.templates) || !rules.templates.length) {
    return { transactions: [], issues: [] };
  }
  const transactions: Array<{ date: string; description: string; amount: number }> = [];
  const issues: string[] = [];
  rules.templates.forEach((template) => {
    const result = applyStatementTemplate(lines, template);
    transactions.push(...result.transactions);
    issues.push(...result.issues.map((issue) => `${template.label ?? template.id ?? 'template'}: ${issue}`));
  });
  return { transactions, issues };
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
  const ruleExtraction = runRuleExtraction(lines, rules?.fields ?? null);
  const heuristics = buildHeuristicValues(lines, docType);
  const mergedValues: Record<string, ExtractedFieldValue> = { ...heuristics, ...ruleExtraction.values };
  const isStatementDoc = /statement/i.test(docType);
  const statementResult = isStatementDoc ? applyStatementRules(lines, rules?.statement ?? null) : { transactions: [], issues: [] };
  return {
    values: mergedValues,
    issues: ruleExtraction.issues,
    usedRuleFields: ruleExtraction.usedRuleFields,
    statementTransactions: statementResult.transactions,
    statementIssues: statementResult.issues,
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

export function parseUserRules(raw: string | null): UserSchematicRules | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return validateRules(parsed);
  } catch (err) {
    console.warn('[parse-worker] unable to parse user rules JSON', err);
    return null;
  }
}
