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
function validateRules(rules) {
    if (!rules)
        return null;
    const result = RuleSetSchema.safeParse(rules);
    if (!result.success) {
        console.warn('[parse-worker] invalid user rules', result.error.issues);
        return null;
    }
    return result.data;
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
function applyRule(field, rule, lines) {
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
function runRuleExtraction(lines, rules) {
    const values = {};
    const issues = [];
    const usedRuleFields = [];
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
function locateNumberByKeywords(lines, keywords) {
    const keywordRegex = new RegExp(keywords.join('|'), 'i');
    for (const line of lines) {
        if (keywordRegex.test(line) && !/\bYTD\b/i.test(line)) {
            const match = line.match(/-?[£$€]?[\d,.()]+/g);
            if (!match)
                continue;
            const candidates = match
                .map((token) => (0, utils_1.parseNumberStrict)(token))
                .filter((value) => value !== null);
            if (candidates.length === 0)
                continue;
            return candidates[candidates.length - 1];
        }
    }
    return null;
}
function buildHeuristicValues(lines, docType) {
    const values = {};
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
function extractFields(text, docType, userRulesRaw) {
    const normalised = (0, utils_1.normaliseWhitespace)(text);
    const lines = (0, utils_1.chunkLines)(normalised);
    const rules = validateRules(userRulesRaw);
    const ruleExtraction = runRuleExtraction(lines, rules);
    const heuristics = buildHeuristicValues(lines, docType);
    const mergedValues = { ...heuristics, ...ruleExtraction.values };
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
