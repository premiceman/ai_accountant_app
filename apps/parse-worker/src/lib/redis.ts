import IORedis from 'ioredis';

let client: IORedis | null = null;

export function getRedis(): IORedis {
  if (client) return client;
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error('REDIS_URL is required for parse worker');
  }
  client = new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
  client.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[parse-worker] Redis error', err);
  });
  return client;
}

export default getRedis;
