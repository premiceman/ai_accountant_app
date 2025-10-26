// backend/utils/rateLimit.js
const cleanupInterval = Number(process.env.RATE_LIMIT_CLEANUP_MS || 60_000);

function createRateLimiter({ windowMs, max }) {
  const window = Math.max(1, Number(windowMs) || 60_000);
  const limit = Math.max(1, Number(max) || 10);
  const buckets = new Map();

  function cleanup() {
    const now = Date.now();
    for (const [key, entry] of buckets.entries()) {
      if (entry.expires <= now) {
        buckets.delete(key);
      }
    }
  }

  setInterval(cleanup, cleanupInterval).unref?.();

  return function rateLimiter(req, res, next) {
    const now = Date.now();
    const identifier = req.user?.id || req.ip || req.headers['x-forwarded-for'] || 'anon';
    const entry = buckets.get(identifier) || { count: 0, expires: now + window };
    if (now > entry.expires) {
      entry.count = 0;
      entry.expires = now + window;
    }
    entry.count += 1;
    buckets.set(identifier, entry);
    if (entry.count > limit) {
      return res.status(429).json({ error: 'Too many requests' });
    }
    next();
  };
}

module.exports = {
  createRateLimiter,
};
