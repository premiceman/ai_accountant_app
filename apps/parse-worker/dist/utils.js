"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normaliseWhitespace = normaliseWhitespace;
exports.chunkLines = chunkLines;
exports.parseNumberStrict = parseNumberStrict;
exports.dedupe = dedupe;
exports.sleep = sleep;
exports.formatMonthYear = formatMonthYear;
exports.clamp = clamp;
function normaliseWhitespace(value) {
    return value.replace(/\r/g, '\n').replace(/\u00a0/g, ' ').replace(/[\t ]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
}
function chunkLines(text) {
    return text
        .split(/\n+/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
}
function parseNumberStrict(raw) {
    if (!raw)
        return null;
    const cleaned = raw.replace(/[$£€]/g, '').replace(/\(/g, '-').replace(/\)/g, '').replace(/,/g, '').trim();
    if (!cleaned)
        return null;
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
}
function dedupe(values) {
    return Array.from(new Set(values));
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function formatMonthYear(date) {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear());
    return `${month}/${year}`;
}
function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}
