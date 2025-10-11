import { getQueueDepth, getRedisClient, isRedisConnected } from '../lib/redis.js';

const startTime = Date.now();
let lastProcessedAt: Date | null = null;

export function markJobProcessed(): void {
  lastProcessedAt = new Date();
}

export async function getHealthSnapshot(): Promise<{
  schematicsEnabled: boolean;
  redis: { connected: boolean; queueDepth: number | null };
  lastProcessedAt: string | null;
  uptimeSec: number;
}> {
  const redisClient = await getRedisClient();
  let queueDepth: number | null = null;
  if (redisClient) {
    queueDepth = await getQueueDepth('parse:jobs');
  }

  return {
    schematicsEnabled: String(process.env.ENABLE_SCHEMATICS || 'false').toLowerCase() === 'true',
    redis: {
      connected: isRedisConnected(),
      queueDepth,
    },
    lastProcessedAt: lastProcessedAt ? lastProcessedAt.toISOString() : null,
    uptimeSec: Math.floor((Date.now() - startTime) / 1000),
  };
}
