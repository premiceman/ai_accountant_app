"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDocupipeConfig = getDocupipeConfig;
exports.resolveDocupipeLabel = resolveDocupipeLabel;
function readEnv(name) {
    const value = process.env[name];
    if (!value)
        return null;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
}
function readNumberEnv(name, fallback) {
    const raw = readEnv(name);
    if (!raw)
        return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
const DOCUPIPE_API_BASE = readEnv('DOCUPIPE_API_BASE') || 'https://api.docupipe.com/v1';
const DOCUPIPE_API_KEY = readEnv('DOCUPIPE_API_KEY');
const DOCUPIPE_POLL_INTERVAL_MS = readNumberEnv('DOCUPIPE_POLL_INTERVAL_MS', 2500);
const DOCUPIPE_POLL_TIMEOUT_MS = readNumberEnv('DOCUPIPE_POLL_TIMEOUT_MS', 5 * 60 * 1000);
const DOCUPIPE_LABEL_BY_DOC_TYPE = {
    payslip: 'payslip',
    current_account_statement: 'bank_statement',
    savings_account_statement: 'bank_statement',
    isa_statement: 'bank_statement',
    investment_statement: 'investment_statement',
    pension_statement: 'pension_statement',
};
function getDocupipeConfig() {
    if (!DOCUPIPE_API_KEY) {
        throw new Error('DOCUPIPE_API_KEY is not configured.');
    }
    return {
        baseUrl: DOCUPIPE_API_BASE.replace(/\/$/, ''),
        apiKey: DOCUPIPE_API_KEY,
        pollIntervalMs: DOCUPIPE_POLL_INTERVAL_MS,
        pollTimeoutMs: DOCUPIPE_POLL_TIMEOUT_MS,
    };
}
function resolveDocupipeLabel(docType) {
    const key = String(docType || '').toLowerCase();
    return DOCUPIPE_LABEL_BY_DOC_TYPE[key] || key || 'document';
}
