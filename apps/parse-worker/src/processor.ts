import type Redis from 'ioredis';
import { submitDocumentToDocupipe, waitForDocupipeResult } from './docupipe';
import { fetchDocumentBytes } from './storage';
import { ParseJob, ParseResultPayload } from './types';

const MAX_ATTEMPTS = 3;
const DEDUPE_TTL_SECONDS = 60 * 10;

function detectMimeType(job: ParseJob): string {
  if (job.mimeType) {
    return job.mimeType;
  }
  return 'application/pdf';
}

export async function shouldSkipJob(redis: Redis, job: ParseJob): Promise<boolean> {
  if (!job.dedupeKey) return false;
  const key = `parse:dedupe:${job.dedupeKey}`;
  const wasSet = await redis.set(key, Date.now().toString(), 'EX', DEDUPE_TTL_SECONDS, 'NX');
  return wasSet === null;
}

export async function processParseJob(redis: Redis, job: ParseJob): Promise<ParseResultPayload> {
  const startedAt = Date.now();
  const buffer = await fetchDocumentBytes(job.storagePath);
  const mimeType = detectMimeType(job);

  const providerStarted = Date.now();
  const submission = await submitDocumentToDocupipe(buffer, {
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

  const status = await waitForDocupipeResult(submission.documentId);
  const providerLatencyMs = Date.now() - providerStarted;

  const warnings: string[] = [];
  if (typeof status.json === 'undefined' || status.json === null) {
    warnings.push('Docupipe returned no JSON payload.');
  }

  const payload: ParseResultPayload = {
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

export async function handleJobFailure(redis: Redis, job: ParseJob, error: unknown): Promise<void> {
  const attempts = Number(job.attempts ?? 0) + 1;
  const key = `parse:error:${job.docId}`;
  const stack = error instanceof Error ? error.stack ?? error.message : String(error);
  await redis.set(
    key,
    JSON.stringify({
      message: error instanceof Error ? error.message : 'Unknown error',
      stack,
      attempts,
      at: new Date().toISOString(),
    })
  );
  if (attempts < MAX_ATTEMPTS) {
    const retryJob: ParseJob = { ...job, attempts };
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

async function postToBackend(job: ParseJob, payload: ParseResultPayload): Promise<void> {
  const endpoint = new URL('/api/parse-result', BACKEND_BASE_URL);
  const body = {
    docId: job.docId,
    userId: job.userId,
    docType: job.docType,
    storagePath: job.storagePath,
    result: payload,
  };

  const headers: Record<string, string> = {
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

export async function writeResult(redis: Redis, job: ParseJob, payload: ParseResultPayload): Promise<void> {
  const key = `parse:result:${job.docId}`;
  await redis.set(key, JSON.stringify(payload));
  await redis.publish('parse:done', job.docId);
  await postToBackend(job, payload);
}
