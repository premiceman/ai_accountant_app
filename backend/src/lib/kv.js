const IORedis = require('ioredis');

let client;
let missingLogged = false;

function getClient() {
  if (client) return client;
  const url = process.env.REDIS_URL;
  if (!url) {
    if (!missingLogged) {
      missingLogged = true;
      console.warn('[kv] REDIS_URL missing; KV operations disabled');
    }
    return null;
  }
  client = new IORedis(url, { lazyConnect: false, maxRetriesPerRequest: null });
  client.on('error', (err) => {
    console.error('[kv] redis error', err);
  });
  return client;
}

async function set(key, value, ttlSeconds) {
  const redis = getClient();
  if (!redis) return false;
  if (ttlSeconds) {
    await redis.set(key, typeof value === 'string' ? value : JSON.stringify(value), 'EX', ttlSeconds);
  } else {
    await redis.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  return true;
}

async function get(key) {
  const redis = getClient();
  if (!redis) return null;
  return redis.get(key);
}

async function lpush(key, value) {
  const redis = getClient();
  if (!redis) return 0;
  const payload = typeof value === 'string' ? value : JSON.stringify(value);
  return redis.lpush(key, payload);
}

module.exports = {
  getClient,
  set,
  get,
  lpush,
};
