// NOTE: Phase-2 — backfill v1 & add /api/analytics/v1/* endpoints. Legacy endpoints unchanged.
'use strict';

class SimpleCache {
  constructor({ ttlSeconds = 600, maxEntries = 200 } = {}) {
    this.ttlMs = ttlSeconds * 1000;
    this.maxEntries = maxEntries;
    this.store = new Map();
  }

  _evictIfNeeded() {
    if (this.store.size <= this.maxEntries) return;
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt <= now) {
        this.store.delete(key);
      }
      if (this.store.size <= this.maxEntries) break;
    }
    while (this.store.size > this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey === undefined) break;
      this.store.delete(oldestKey);
    }
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value, ttlSeconds) {
    const ttl = typeof ttlSeconds === 'number' ? ttlSeconds * 1000 : this.ttlMs;
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttl,
    });
    this._evictIfNeeded();
  }
}

module.exports = { SimpleCache };
