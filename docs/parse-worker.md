# Parsing worker integration guide

The parsing worker consumes jobs from Redis and produces structured document insights. Use the following helpers from any service that needs parsing:

## Enqueueing

```js
await redis.lpush('parse:jobs', JSON.stringify({
  docId: 'document-id',
  userId: 'user-id',
  storagePath: 'https://storage/path/to/file.pdf',
  docType: 'payslip',
  userRulesVersion: 'optional-version-id',
  dedupeKey: 'optional-dedupe'
}));
```

## Environment

- `REDIS_URL` must point to the shared Redis instance (for example `redis://redis.internal:6379`).
- `PARSE_WORKER_TOKEN` secures the `/api/parse-result` callback. Configure the backend and worker with the same secret and send `Authorization: Bearer <token>` from the worker.

## Reading results

- Poll `parse:result:{docId}` for a JSON payload identical to the example in `apps/parse-worker/README.md`.
- Subscribe to the `parse:done` channel for completion notifications.
- Errors are stored under `parse:error:{docId}`.

## User defined extraction rules

- Active mapping key: `map:{userId}:{docType}:active` (JSON mapping with field → rule).
- Versioned mapping key: `map:{userId}:{docType}:{version}`.
- When updating rules, write to a new version key and set the active key to that version string.

## Pure helpers

The worker exports `extractFields` and `suggestAnchors` for use in previews/validation flows without queueing a job.
