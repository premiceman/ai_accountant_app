"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadActiveUserRules = loadActiveUserRules;
exports.shouldSkipJob = shouldSkipJob;
exports.processParseJob = processParseJob;
exports.handleJobFailure = handleJobFailure;
exports.writeResult = writeResult;
const dates_1 = require("./dates");
const fields_1 = require("./fields");
const storage_1 = require("./storage");
const text_extraction_1 = require("./text-extraction");
const utils_1 = require("./utils");
const MAX_ATTEMPTS = 3;
const DEDUPE_TTL_SECONDS = 60 * 10;
function isJsonPayload(value) {
    const trimmed = value.trim();
    return trimmed.startsWith('{') || trimmed.startsWith('[');
}
async function loadActiveUserRules(redis, job) {
    const docType = job.docType || 'unknown';
    const userId = job.userId;
    let version = job.userRulesVersion ?? null;
    let activeRaw = null;
    if (version) {
        activeRaw = await redis.get(`map:${userId}:${docType}:${version}`);
    }
    else {
        const pointer = await redis.get(`map:${userId}:${docType}:active`);
        if (pointer) {
            if (isJsonPayload(pointer)) {
                activeRaw = pointer;
            }
            else {
                version = pointer.trim();
                if (version) {
                    activeRaw = await redis.get(`map:${userId}:${docType}:${version}`);
                }
            }
        }
    }
    if (!activeRaw) {
        return { rules: null, version: version ?? null, raw: null };
    }
    return { rules: (0, fields_1.parseUserRules)(activeRaw), version: version ?? null, raw: activeRaw };
}
async function shouldSkipJob(redis, job) {
    if (!job.dedupeKey)
        return false;
    const key = `parse:dedupe:${job.dedupeKey}`;
    const wasSet = await redis.set(key, Date.now().toString(), 'EX', DEDUPE_TTL_SECONDS, 'NX');
    return wasSet === null;
}
async function processParseJob(redis, job) {
    const startedAt = Date.now();
    const buffer = await (0, storage_1.fetchDocumentBytes)(job.storagePath);
    const extracted = await (0, text_extraction_1.extractText)(buffer, job.docType);
    const normalisedText = (0, utils_1.normaliseWhitespace)(extracted.text);
    const dateExtraction = (0, dates_1.extractDates)(normalisedText);
    const ruleTimerStart = Date.now();
    const { rules, version, raw } = await loadActiveUserRules(redis, job);
    const fields = (0, fields_1.extractFields)(extracted, job.docType, rules);
    const ruleLatencyMs = Date.now() - ruleTimerStart;
    const metrics = {};
    Object.entries(fields.values).forEach(([field, payload]) => {
        if (typeof payload.value === 'number') {
            metrics[field] = payload.value;
        }
    });
    const fieldPositions = Object.fromEntries(Object.entries(fields.values)
        .filter(([, value]) => Array.isArray(value.positions) && value.positions.length > 0)
        .map(([key, value]) => [key, value.positions]));
    const metadata = {
        payDate: dateExtraction.payDate,
        periodStart: dateExtraction.periodStart,
        periodEnd: dateExtraction.periodEnd,
        extractionSource: version ? `rules@${version}` : fields.usedRuleFields.length ? 'rules' : 'heuristics',
        employerName: typeof fields.values.employerName?.value === 'string' ? fields.values.employerName.value : null,
        personName: typeof fields.values.employeeName?.value === 'string' ? fields.values.employeeName.value : null,
        rulesVersion: version,
        dateConfidence: dateExtraction.confidence,
        fieldPositions: Object.keys(fieldPositions).length ? fieldPositions : undefined,
    };
    const payload = {
        ok: true,
        classification: {
            docType: job.docType,
            confidence: dateExtraction.confidence,
            anchors: dateExtraction.anchors,
        },
        fieldValues: fields.values,
        insights: { metrics },
        narrative: [],
        metadata,
        text: normalisedText,
        storage: { path: job.storagePath, processedAt: new Date().toISOString() },
        metrics: {
            latencyMs: Date.now() - startedAt,
            ruleLatencyMs,
        },
        softErrors: fields.issues,
        statement: fields.statementTransactions.length || fields.statementIssues.length
            ? {
                transactions: fields.statementTransactions,
                issues: fields.statementIssues,
            }
            : undefined,
    };
    if (fields.issues.length && raw) {
        // preserve the active version under a historical key with timestamp for debugging
        const stamp = new Date().toISOString();
        await redis.set(`map:${job.userId}:${job.docType}:${version ?? 'active'}:last-error`, JSON.stringify({ stamp, issues: fields.issues }));
    }
    return payload;
}
async function handleJobFailure(redis, job, error) {
    const attempts = Number(job.attempts ?? 0) + 1;
    const key = `parse:error:${job.docId}`;
    const stack = error instanceof Error ? error.stack ?? error.message : String(error);
    await redis.set(key, JSON.stringify({ message: error instanceof Error ? error.message : 'Unknown error', stack, attempts, at: new Date().toISOString() }));
    if (attempts < MAX_ATTEMPTS) {
        const retryJob = { ...job, attempts };
        const delay = Math.min(60000, attempts * 5000);
        setTimeout(() => {
            redis.lpush('parse:jobs', JSON.stringify(retryJob)).catch((err) => {
                console.error('[parse-worker] failed to requeue job', err);
            });
        }, delay);
    }
}
const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL || 'http://localhost:3000';
const PARSE_WORKER_TOKEN = process.env.PARSE_WORKER_TOKEN || '';
async function postToBackend(job, payload) {
    const endpoint = new URL('/api/parse-result', BACKEND_BASE_URL);
    const body = {
        docId: job.docId,
        userId: job.userId,
        docType: job.docType,
        storagePath: job.storagePath,
        result: payload,
    };
    const headers = {
        'Content-Type': 'application/json',
    };
    if (PARSE_WORKER_TOKEN) {
        headers.Authorization = `Bearer ${PARSE_WORKER_TOKEN}`;
    }
    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`HTTP ${res.status}: ${text}`);
        }
    }
    catch (err) {
        console.error('[parse-worker] failed to POST result', err);
        throw err;
    }
}
async function writeResult(redis, job, payload) {
    const key = `parse:result:${job.docId}`;
    await redis.set(key, JSON.stringify(payload));
    await redis.publish('parse:done', job.docId);
    await postToBackend(job, payload);
}
