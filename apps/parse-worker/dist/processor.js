"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldSkipJob = shouldSkipJob;
exports.processParseJob = processParseJob;
exports.handleJobFailure = handleJobFailure;
exports.writeResult = writeResult;
const docupipe_1 = require("./docupipe");
const storage_1 = require("./storage");
const MAX_ATTEMPTS = 3;
const DEDUPE_TTL_SECONDS = 60 * 10;
function detectMimeType(job) {
    if (job.mimeType) {
        return job.mimeType;
    }
    return 'application/pdf';
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
    const mimeType = detectMimeType(job);
    const providerStarted = Date.now();
    const submission = await (0, docupipe_1.submitDocumentToDocupipe)(buffer, {
        docType: job.docType,
        mimeType,
        fileName: job.originalName || null,
        metadata: {
            docId: job.docId,
            userId: job.userId,
            storagePath: job.storagePath,
            source: job.source || null,
        },
    });
    const status = await (0, docupipe_1.waitForDocupipeResult)(submission.documentId);
    const providerLatencyMs = Date.now() - providerStarted;
    const warnings = [];
    if (typeof status.json === 'undefined' || status.json === null) {
        warnings.push('Docupipe returned no JSON payload.');
    }
    const payload = {
        ok: true,
        provider: 'docupipe',
        docType: job.docType,
        docId: job.docId,
        docupipe: status,
        storage: {
            path: job.storagePath,
            processedAt: new Date().toISOString(),
        },
        metrics: {
            latencyMs: Date.now() - startedAt,
            providerLatencyMs,
        },
        warnings,
    };
    return payload;
}
async function handleJobFailure(redis, job, error) {
    const attempts = Number(job.attempts ?? 0) + 1;
    const key = `parse:error:${job.docId}`;
    const stack = error instanceof Error ? error.stack ?? error.message : String(error);
    await redis.set(key, JSON.stringify({
        message: error instanceof Error ? error.message : 'Unknown error',
        stack,
        attempts,
        at: new Date().toISOString(),
    }));
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
async function writeResult(redis, job, payload) {
    const key = `parse:result:${job.docId}`;
    await redis.set(key, JSON.stringify(payload));
    await redis.publish('parse:done', job.docId);
    await postToBackend(job, payload);
}
