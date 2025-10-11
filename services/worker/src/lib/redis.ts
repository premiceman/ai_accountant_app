type RedisClient = {
  on(event: string, handler: (...args: unknown[]) => void): void;
  llen(key: string): Promise<number>;
};

let client: RedisClient | null = null;
let connected = false;
let loadAttempted = false;

async function createRedisClient(): Promise<RedisClient | null> {
  if (!process.env.REDIS_URL) {
    return null;
  }

  try {
    const mod = (await import('ioredis').catch(() => null)) as { default?: new (...args: any[]) => RedisClient } | null;
    if (!mod) {
      return null;
    }

    const RedisCtor = (mod.default ?? (mod as unknown as new (...args: any[]) => RedisClient)) as new (
      connectionString: string,
      options: Record<string, unknown>
    ) => RedisClient;

    const instance = new RedisCtor(process.env.REDIS_URL, { maxRetriesPerRequest: null });
    instance.on('ready', () => {
      connected = true;
    });
    instance.on('end', () => {
      connected = false;
    });
    instance.on('error', () => {
      connected = false;
    });
    connected = false;
    return instance;
  } catch {
    return null;
  }
}

export async function getRedisClient(): Promise<RedisClient | null> {
  if (client) {
    return client;
  }

  if (loadAttempted) {
    return null;
  }

  loadAttempted = true;
  client = await createRedisClient();
  return client;
}

export function isRedisConnected(): boolean {
  return connected;
}

export async function getQueueDepth(key: string): Promise<number | null> {
  const redis = await getRedisClient();
  if (!redis) return null;
  try {
    return await redis.llen(key);
  } catch {
    return null;
  }
}
