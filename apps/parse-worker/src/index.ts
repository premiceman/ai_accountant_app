import Redis from 'ioredis';
import { handleJobFailure, processParseJob, shouldSkipJob, writeResult } from './processor';
import { ParseJob } from './types';
import { sleep } from './utils';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

class ParseWorker {
  private redis: Redis;
  private running = false;

  constructor(private readonly queueName: string) {
    this.redis = new Redis(REDIS_URL, { lazyConnect: false });
    this.redis.on('error', (err) => {
      console.error('[parse-worker] redis error', err);
    });
  }

  async start() {
    this.running = true;
    console.log('[parse-worker] starting worker');
    while (this.running) {
      try {
        const result = await this.redis.brpop(this.queueName, 0);
        if (!result) continue;
        const [, rawJob] = result;
        let job: ParseJob;
        try {
          job = JSON.parse(rawJob) as ParseJob;
        } catch (err) {
          console.error('[parse-worker] failed to parse job payload', rawJob, err);
          continue;
        }

        if (await shouldSkipJob(this.redis, job)) {
          console.log('[parse-worker] skipping deduped job', job.docId);
          continue;
        }

        const started = Date.now();
        try {
          const payload = await processParseJob(this.redis, job);
          await writeResult(this.redis, job, payload);
          console.log('[parse-worker] processed job', job.docId, {
            latencyMs: payload.metrics.latencyMs,
            ruleLatencyMs: payload.metrics.ruleLatencyMs,
            dateConfidence: payload.metadata.dateConfidence,
            rulesVersion: payload.metadata.rulesVersion,
          });
        } catch (err) {
          console.error('[parse-worker] job failed', job.docId, err);
          await handleJobFailure(this.redis, job, err);
        } finally {
          const elapsed = Date.now() - started;
          console.log('[parse-worker] job completed (success or retry scheduled)', job.docId, { elapsed });
        }
      } catch (err) {
        console.error('[parse-worker] loop error', err);
        await sleep(1000);
      }
    }
  }

  async stop() {
    this.running = false;
    await this.redis.quit();
  }
}

async function main() {
  const worker = new ParseWorker('parse:jobs');
  process.on('SIGINT', async () => {
    console.log('[parse-worker] received SIGINT, shutting down');
    await worker.stop();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    console.log('[parse-worker] received SIGTERM, shutting down');
    await worker.stop();
    process.exit(0);
  });
  await worker.start();
}

main().catch((err) => {
  console.error('[parse-worker] fatal error', err);
  process.exit(1);
});

export { extractFields, suggestAnchors } from './fields';
