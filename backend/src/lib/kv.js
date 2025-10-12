let IORedis;
try {
  // Optional dependency – prefer Redis when available but fall back to in-memory storage otherwise.
  // eslint-disable-next-line global-require
  IORedis = require('ioredis');
} catch (err) {
  IORedis = null;
  const message = err?.message || err;
  console.warn('⚠️  ioredis not available – using in-memory KV store. Data will not persist between restarts.', message);
}

let client;
let missingLogged = false;

const memoryStore = new Map();

function serialise(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function deserialise(raw) {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return raw;
  }
}

function purgeExpiredMemoryEntries() {
  const now = Date.now();
  for (const [key, entry] of memoryStore.entries()) {
    if (entry.expiresAt && entry.expiresAt <= now) {
      memoryStore.delete(key);
    }
  }
}

function setMemory(key, value, ttlSeconds) {
  const record = { value: serialise(value), expiresAt: null };
  if (ttlSeconds && Number.isFinite(Number(ttlSeconds)) && ttlSeconds > 0) {
    record.expiresAt = Date.now() + Number(ttlSeconds) * 1000;
  }
  memoryStore.set(key, record);
  return true;
}

function getMemory(key) {
  purgeExpiredMemoryEntries();
  const entry = memoryStore.get(key);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt <= Date.now()) {
    memoryStore.delete(key);
    return null;
  }
  return deserialise(entry.value);
}

function lpushMemory(key, value) {
  purgeExpiredMemoryEntries();
  const existing = getMemory(key);
  const list = Array.isArray(existing) ? existing : [];
  list.unshift(value);
  setMemory(key, list, null);
  return list.length;
}

function delMemory(key) {
  const existed = memoryStore.delete(key);
  return existed ? 1 : 0;
}

function expireMemory(key, ttlSeconds) {
  if (!memoryStore.has(key) || !ttlSeconds || ttlSeconds <= 0) return false;
  const entry = memoryStore.get(key);
  entry.expiresAt = Date.now() + ttlSeconds * 1000;
  memoryStore.set(key, entry);
  return true;
}

function getClient() {
  if (!IORedis) return null;
  if (client) return client;
  const url = process.env.REDIS_URL;
  if (!url) {
    if (!missingLogged) {
      missingLogged = true;
      console.warn('[kv] REDIS_URL missing; Redis-backed KV disabled. Falling back to in-memory cache.');
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
  if (!redis) return setMemory(key, value, ttlSeconds);
  if (ttlSeconds) {
    await redis.set(key, serialise(value), 'EX', ttlSeconds);
  } else {
    await redis.set(key, serialise(value));
  }
  return true;
}

async function get(key) {
  const redis = getClient();
  if (!redis) return getMemory(key);
  const raw = await redis.get(key);
  return deserialise(raw);
}

async function lpush(key, value) {
  const redis = getClient();
  if (!redis) return lpushMemory(key, value);
  const payload = serialise(value);
  return redis.lpush(key, payload);
}

async function del(key) {
  const redis = getClient();
  if (!redis) return delMemory(key);
  return redis.del(key);
}

async function expire(key, ttlSeconds) {
  const redis = getClient();
  if (!redis) return expireMemory(key, ttlSeconds);
  if (!ttlSeconds || ttlSeconds <= 0) return false;
  await redis.expire(key, ttlSeconds);
  return true;
}

module.exports = {
  getClient,
  set,
  get,
  lpush,
  del,
  expire,
};
