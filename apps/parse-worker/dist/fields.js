"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractFields = extractFields;
exports.suggestAnchors = suggestAnchors;
exports.parseUserRules = parseUserRules;
const chrono = __importStar(require("chrono-node"));
const zod_1 = require("zod");
const utils_1 = require("./utils");
const BaseRuleSchema = zod_1.z.object({
    expectedType: zod_1.z.enum(['number', 'string', 'date']),
    label: zod_1.z.string().optional(),
});
const AnchorRegexRuleSchema = BaseRuleSchema.extend({
    strategy: zod_1.z.literal('anchor+regex'),
    anchor: zod_1.z.string().min(1),
    regex: zod_1.z.string().min(1),
});
const LineOffsetRuleSchema = BaseRuleSchema.extend({
    strategy: zod_1.z.literal('line-offset'),
    anchor: zod_1.z.string().min(1),
    lineOffset: zod_1.z.number().int(),
});
const BoxRuleSchema = BaseRuleSchema.extend({
    strategy: zod_1.z.literal('box'),
    top: zod_1.z.number(),
    left: zod_1.z.number(),
    width: zod_1.z.number(),
    height: zod_1.z.number(),
});
const RuleSchema = zod_1.z.discriminatedUnion('strategy', [AnchorRegexRuleSchema, LineOffsetRuleSchema, BoxRuleSchema]);
const RuleSetSchema = zod_1.z.record(RuleSchema);
const STATEMENT_COLUMN_KEYS = ['date', 'description', 'amount', 'ignore'];
const StatementColumnSchema = zod_1.z.object({
    key: zod_1.z.enum(STATEMENT_COLUMN_KEYS).default('description'),
    regex: zod_1.z.string().optional(),
    start: zod_1.z.number().int().min(0).optional(),
    end: zod_1.z.number().int().min(0).optional(),
});
const StatementTemplateSchema = zod_1.z.object({
    id: zod_1.z.string().optional(),
    label: zod_1.z.string().optional(),
    startLine: zod_1.z.number().int().min(0),
    lineStride: zod_1.z.number().int().min(1).optional(),
    maxRows: zod_1.z.number().int().min(1).optional(),
    stopRegex: zod_1.z.string().optional(),
    columns: zod_1.z.array(StatementColumnSchema).min(1),
});
const StatementRulesSchema = zod_1.z.object({
    templates: zod_1.z.array(StatementTemplateSchema).min(1),
});
const CompositeRuleSchema = zod_1.z.object({
    fields: RuleSetSchema.optional(),
    statement: StatementRulesSchema.optional(),
});
function validateRules(rules) {
    if (!rules)
        return null;
    const composite = CompositeRuleSchema.safeParse(rules);
    if (composite.success) {
        const typedFields = (composite.data.fields ?? null);
        const typedStatement = (composite.data.statement ?? null);
        return {
            fields: typedFields,
            statement: typedStatement,
        };
    }
    const legacy = RuleSetSchema.safeParse(rules);
    if (legacy.success) {
        return { fields: legacy.data, statement: null };
    }
    console.warn('[parse-worker] invalid user rules', composite.error.issues);
    return null;
}
function createCaseInsensitiveRegex(pattern) {
    try {
        return new RegExp(pattern, 'i');
    }
    catch (err) {
        return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }
}
function findLineIndex(lines, anchor) {
    const anchorRegex = createCaseInsensitiveRegex(anchor);
    return lines.findIndex((line) => anchorRegex.test(line));
}
function createContext(extracted) {
    const geometry = new Map();
    extracted.geometry.forEach((line) => {
        geometry.set(line.lineIndex, line);
    });
    return {
        lines: extracted.lines,
        geometry,
        geometryList: extracted.geometry,
    };
}
function getLineGeometry(context, index) {
    return context.geometry.get(index);
}
function buildPosition(context, lineIndex, charStart, length) {
    if (lineIndex < 0)
        return null;
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
function boxesIntersect(a, b) {
    const ax2 = a.left + a.width;
    const ay2 = a.top + a.height;
    const bx2 = b.left + b.width;
    const by2 = b.top + b.height;
    return a.left < bx2 && ax2 > b.left && a.top < by2 && ay2 > b.top;
}
function collectTextFromBox(context, rule) {
    const perLine = new Map();
    context.geometryList.forEach((line) => {
        if (!line.bounds || !boxesIntersect(line.bounds, rule))
            return;
        const relevant = line.segments.filter((segment) => boxesIntersect(segment.box, rule));
        if (!relevant.length)
            return;
        relevant.sort((a, b) => a.charStart - b.charStart);
        const merged = [];
        relevant.forEach((segment) => {
            const target = { start: segment.charStart, end: segment.charEnd };
            const last = merged[merged.length - 1];
            if (last && target.start <= last.end) {
                last.end = Math.max(last.end, target.end);
            }
            else {
                merged.push(target);
            }
        });
        perLine.set(line.lineIndex, merged);
    });
    if (!perLine.size)
        return null;
    const sortedLines = Array.from(perLine.entries()).sort((a, b) => a[0] - b[0]);
    const rawLines = [];
    const positions = [];
    sortedLines.forEach(([lineIndex, ranges]) => {
        const lineText = context.lines[lineIndex] || '';
        const fragments = [];
        ranges.forEach((range) => {
            const fragment = lineText.slice(range.start, range.end);
            if (!fragment.trim())
                return;
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
    if (!rawLines.length)
        return null;
    const raw = rawLines.join('\n').trim();
    if (!raw)
        return null;
    return { raw, positions };
}
function enforceType(expected, raw) {
    if (!raw)
        return { value: null };
    if (expected === 'number') {
        const parsed = (0, utils_1.parseNumberStrict)(raw);
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
        return { value: (0, utils_1.formatMonthYear)(parsed) };
    }
    return { value: (0, utils_1.normaliseWhitespace)(raw) };
}
function applyRule(field, rule, context) {
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
function runRuleExtraction(context, rules) {
    const values = {};
    const issues = [];
    const usedRuleFields = [];
    const { lines } = context;
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
function clampRange(line, start, end) {
    const len = line.length;
    const safeStart = typeof start === 'number' ? Math.max(0, Math.min(start, len)) : 0;
    const safeEnd = typeof end === 'number' ? Math.max(safeStart, Math.min(end, len)) : len;
    return { start: safeStart, end: safeEnd };
}
function extractColumnValue(line, column) {
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
function parseStatementDate(raw) {
    if (!raw)
        return null;
    const parsed = chrono.parseDate(raw, new Date(), { forwardDate: true });
    if (!parsed)
        return null;
    return parsed.toISOString().slice(0, 10);
}
function parseStatementAmount(raw) {
    if (!raw)
        return null;
    return (0, utils_1.parseNumberStrict)(raw);
}
function applyStatementTemplate(lines, template) {
    const transactions = [];
    const issues = [];
    const stride = template.lineStride && template.lineStride > 0 ? template.lineStride : 1;
    const limit = template.maxRows && template.maxRows > 0 ? template.maxRows : Number.MAX_SAFE_INTEGER;
    const stopRegex = template.stopRegex ? createCaseInsensitiveRegex(template.stopRegex) : null;
    for (let step = 0; step < limit; step += 1) {
        const lineIndex = template.startLine + step * stride;
        if (lineIndex < 0 || lineIndex >= lines.length)
            break;
        const line = lines[lineIndex];
        if (!line || !line.trim()) {
            if (transactions.length === 0)
                continue;
            break;
        }
        if (stopRegex && stopRegex.test(line))
            break;
        const extracted = {};
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
            if (column.key === 'ignore')
                continue;
            extracted[column.key] = value;
        }
        if (skip) {
            if (!transactions.length)
                break;
            continue;
        }
        const date = parseStatementDate(extracted.date ?? null);
        if (!date) {
            issues.push(`Line ${lineIndex + 1}: Unable to parse date`);
            if (!transactions.length)
                break;
            continue;
        }
        const amount = parseStatementAmount(extracted.amount ?? null);
        if (amount === null) {
            issues.push(`Line ${lineIndex + 1}: Unable to parse amount`);
            if (!transactions.length)
                break;
            continue;
        }
        const description = (0, utils_1.normaliseWhitespace)(extracted.description ?? '') || 'Transaction';
        transactions.push({ date, description, amount });
    }
    return { transactions, issues };
}
function applyStatementRules(lines, rules) {
    if (!rules || !Array.isArray(rules.templates) || !rules.templates.length) {
        return { transactions: [], issues: [] };
    }
    const transactions = [];
    const issues = [];
    rules.templates.forEach((template) => {
        const result = applyStatementTemplate(lines, template);
        transactions.push(...result.transactions);
        issues.push(...result.issues.map((issue) => `${template.label ?? template.id ?? 'template'}: ${issue}`));
    });
    return { transactions, issues };
}
function locateNumberByKeywords(context, keywords) {
    const { lines } = context;
    const keywordRegex = new RegExp(keywords.join('|'), 'i');
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (keywordRegex.test(line) && !/\bYTD\b/i.test(line)) {
            const numberPattern = /-?[£$€]?[\d,.()]+/g;
            let match = null;
            let candidate = null;
            while ((match = numberPattern.exec(line))) {
                const parsed = (0, utils_1.parseNumberStrict)(match[0]);
                if (parsed === null)
                    continue;
                candidate = {
                    value: parsed,
                    lineIndex: index,
                    charStart: match.index,
                    charEnd: match.index + match[0].length,
                };
            }
            if (candidate)
                return candidate;
        }
    }
    return null;
}
function buildHeuristicValues(context, docType) {
    const values = {};
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
            const position = buildPosition(context, deductions.lineIndex, deductions.charStart, deductions.charEnd - deductions.charStart);
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
function extractFields(extracted, docType, userRulesRaw) {
    const context = createContext(extracted);
    const { lines } = context;
    const rules = validateRules(userRulesRaw);
    const ruleExtraction = runRuleExtraction(context, rules?.fields ?? null);
    const heuristics = buildHeuristicValues(context, docType);
    const mergedValues = { ...heuristics, ...ruleExtraction.values };
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
function suggestAnchors(text) {
    const lines = (0, utils_1.chunkLines)(text);
    const colonAnchors = lines
        .filter((line) => line.includes(':'))
        .map((line) => line.split(':')[0].trim())
        .filter((token) => token.length > 3);
    return (0, utils_1.dedupe)([...COMMON_ANCHORS, ...colonAnchors]).slice(0, 50);
}
function parseUserRules(raw) {
    if (!raw)
        return null;
    try {
        const parsed = JSON.parse(raw);
        return validateRules(parsed);
    }
    catch (err) {
        console.warn('[parse-worker] unable to parse user rules JSON', err);
        return null;
    }
}
