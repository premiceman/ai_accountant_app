import type Redis from 'ioredis';
import { extractDates } from './dates';
import { extractFields, parseUserRules } from './fields';
import { fetchDocumentBytes } from './storage';
import { extractText } from './text-extraction';
import { normaliseWhitespace } from './utils';
import { ParseJob, ParseResultPayload } from './types';

const MAX_ATTEMPTS = 3;
const DEDUPE_TTL_SECONDS = 60 * 10;

function isJsonPayload(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

async function resolveUserRules(
  redis: Redis,
  job: ParseJob
): Promise<{ rules: unknown; version: string | null; raw: string | null }> {
  const docType = job.docType || 'unknown';
  const userId = job.userId;
  let activeRaw: string | null = null;
  let version: string | null = job.userRulesVersion ?? null;
  if (version) {
    activeRaw = await redis.get(`map:${userId}:${docType}:${version}`);
  } else {
    const rawActive = await redis.get(`map:${userId}:${docType}:active`);
    if (rawActive) {
      if (isJsonPayload(rawActive)) {
        activeRaw = rawActive;
      } else {
        version = rawActive.trim();
        activeRaw = version ? await redis.get(`map:${userId}:${docType}:${version}`) : null;
      }
    }
  }
  return { rules: parseUserRules(activeRaw), version: version ?? null, raw: activeRaw };
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
  const text = await extractText(buffer, job.docType);
  const normalisedText = normaliseWhitespace(text);
  const dateExtraction = extractDates(normalisedText);

  const ruleTimerStart = Date.now();
  const { rules, version, raw } = await resolveUserRules(redis, job);
  const fields = extractFields(normalisedText, job.docType, rules);
  const ruleLatencyMs = Date.now() - ruleTimerStart;

  const metrics: Record<string, number | null> = {};
  Object.entries(fields.values).forEach(([field, payload]) => {
    if (typeof payload.value === 'number') {
      metrics[field] = payload.value;
    }
  });

  const metadata = {
    payDate: dateExtraction.payDate,
    periodStart: dateExtraction.periodStart,
    periodEnd: dateExtraction.periodEnd,
    extractionSource: version ? `rules@${version}` : fields.usedRuleFields.length ? 'rules' : 'heuristics',
    employerName: typeof fields.values.employerName?.value === 'string' ? (fields.values.employerName.value as string) : null,
    personName: typeof fields.values.employeeName?.value === 'string' ? (fields.values.employeeName.value as string) : null,
    rulesVersion: version,
    dateConfidence: dateExtraction.confidence,
  } as const;

  const payload: ParseResultPayload = {
    ok: true,
    classification: {
      docType: job.docType,
      confidence: dateExtraction.confidence,
      anchors: dateExtraction.anchors,
    },
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
  };

  if (fields.issues.length && raw) {
    // preserve the active version under a historical key with timestamp for debugging
    const stamp = new Date().toISOString();
    await redis.set(`map:${job.userId}:${job.docType}:${version ?? 'active'}:last-error`, JSON.stringify({ stamp, issues: fields.issues }));
  }

  return payload;
}

export async function handleJobFailure(redis: Redis, job: ParseJob, error: unknown): Promise<void> {
  const attempts = Number(job.attempts ?? 0) + 1;
  const key = `parse:error:${job.docId}`;
  const stack = error instanceof Error ? error.stack ?? error.message : String(error);
  await redis.set(key, JSON.stringify({ message: error instanceof Error ? error.message : 'Unknown error', stack, attempts, at: new Date().toISOString() }));
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

export async function writeResult(redis: Redis, job: ParseJob, payload: ParseResultPayload): Promise<void> {
  const key = `parse:result:${job.docId}`;
  await redis.set(key, JSON.stringify(payload));
  await redis.publish('parse:done', job.docId);
}
