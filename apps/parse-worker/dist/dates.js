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
exports.extractDates = extractDates;
const chrono = __importStar(require("chrono-node"));
const utils_1 = require("./utils");
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
const TEXTUAL_PATTERN = new RegExp(`(\\b(?:${MONTH_NAMES.join('|')})\\b)[\\s-]*(\\d{1,2})?,?[\\s-]*(\\d{2,4})`, 'gi');
const YYYY_MM_DD = /(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/g;
const DD_MM_YYYY = /(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/g;
const ANCHORS = [
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
};
function inferYear(yearRaw) {
    const year = Number.parseInt(yearRaw, 10);
    if (year < 100) {
        const now = new Date();
        const currentCentury = Math.floor(now.getFullYear() / 100) * 100;
        return currentCentury + year;
    }
    return year;
}
function buildCandidate(options) {
    const { month, day, year } = options;
    if (!month || !year)
        return null;
    const safeDay = Number.isFinite(day) && day > 0 ? day : 1;
    const date = new Date(year, month - 1, safeDay);
    if (!Number.isFinite(date.valueOf()))
        return null;
    const normalized = (0, utils_1.formatMonthYear)(date);
    return {
        normalized,
        raw: options.raw,
        date,
        lineIndex: options.lineIndex,
        tags: options.tags,
        confidence: (0, utils_1.clamp)(BASE_CONFIDENCE[options.source] + scoreAnchors(options.tags), 0, 1),
        source: options.source,
    };
}
function scoreAnchors(tags) {
    let score = 0;
    for (const anchor of ANCHORS) {
        if (tags.has(anchor.tag)) {
            score += anchor.weight;
        }
    }
    return score;
}
function detectAnchors(line) {
    const tags = new Set();
    for (const anchor of ANCHORS) {
        if (anchor.pattern.test(line)) {
            tags.add(anchor.tag);
        }
    }
    return tags;
}
function collectRegex(line, lineIndex, tags) {
    const candidates = [];
    for (const regex of [YYYY_MM_DD, DD_MM_YYYY]) {
        regex.lastIndex = 0;
        let match;
        while ((match = regex.exec(line))) {
            const [raw, a, b, c] = match;
            if (regex === YYYY_MM_DD) {
                const year = Number.parseInt(a, 10);
                const month = Number.parseInt(b, 10);
                const day = Number.parseInt(c, 10);
                const candidate = buildCandidate({ raw, lineIndex, month, day, year, tags, source: 'regex' });
                if (candidate)
                    candidates.push(candidate);
            }
            else {
                const day = Number.parseInt(a, 10);
                const month = Number.parseInt(b, 10);
                const year = inferYear(c);
                const candidate = buildCandidate({ raw, lineIndex, month, day, year, tags, source: 'regex' });
                if (candidate)
                    candidates.push(candidate);
            }
        }
    }
    TEXTUAL_PATTERN.lastIndex = 0;
    let textual;
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
        if (candidate)
            candidates.push(candidate);
    }
    return candidates;
}
function collectChrono(line, lineIndex, tags) {
    if (tags.size === 0)
        return [];
    const parsed = chrono.parse(line, new Date(), { forwardDate: true });
    return parsed
        .map((result) => {
        const date = result.start?.date();
        if (!date)
            return null;
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
        .filter((candidate) => candidate !== null);
}
function pickCandidate(candidates, predicate) {
    const filtered = candidates.filter(predicate);
    if (!filtered.length)
        return null;
    filtered.sort((a, b) => b.confidence - a.confidence || a.lineIndex - b.lineIndex);
    return filtered[0];
}
function extractDates(text) {
    const lines = (0, utils_1.chunkLines)(text);
    const candidates = [];
    lines.forEach((line, index) => {
        const tags = detectAnchors(line);
        candidates.push(...collectRegex(line, index, tags));
        candidates.push(...collectChrono(line, index, tags));
    });
    const unique = new Map();
    candidates.forEach((candidate) => {
        const key = `${candidate.normalized}:${candidate.lineIndex}:${candidate.tags.size}`;
        if (!unique.has(key) || unique.get(key).confidence < candidate.confidence) {
            unique.set(key, candidate);
        }
    });
    const finalCandidates = Array.from(unique.values());
    const payDateCandidate = pickCandidate(finalCandidates, (candidate) => candidate.tags.has('payDate')) ||
        pickCandidate(finalCandidates, (candidate) => candidate.tags.has('period')) ||
        pickCandidate(finalCandidates, () => true);
    const periodStartCandidate = pickCandidate(finalCandidates, (candidate) => candidate.tags.has('periodStart')) ||
        pickCandidate(finalCandidates, (candidate) => candidate.tags.has('period')) ||
        null;
    const periodEndCandidate = pickCandidate(finalCandidates, (candidate) => candidate.tags.has('periodEnd')) ||
        pickCandidate(finalCandidates, (candidate) => candidate.tags.has('period')) ||
        null;
    const anchors = new Set();
    if (payDateCandidate)
        payDateCandidate.tags.forEach((tag) => anchors.add(tag));
    if (periodStartCandidate)
        periodStartCandidate.tags.forEach((tag) => anchors.add(tag));
    if (periodEndCandidate)
        periodEndCandidate.tags.forEach((tag) => anchors.add(tag));
    const confidence = Math.max(payDateCandidate?.confidence ?? 0, periodStartCandidate?.confidence ?? 0, periodEndCandidate?.confidence ?? 0);
    return {
        payDate: payDateCandidate?.normalized ?? null,
        periodStart: periodStartCandidate?.normalized ?? null,
        periodEnd: periodEndCandidate?.normalized ?? null,
        anchors: Array.from(anchors),
        confidence,
    };
}
