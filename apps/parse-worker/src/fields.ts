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

function runRuleExtraction(lines: string[], rules: UserRuleSet | null): Pick<ExtractFieldsResult, 'values' | 'issues' | 'usedRuleFields'> {
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
