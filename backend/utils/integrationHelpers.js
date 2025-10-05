// backend/utils/integrationHelpers.js
const crypto = require('crypto');

const VALID_STATUSES = ['not_connected', 'pending', 'error', 'connected'];

function normaliseKey(key = '') {
  return String(key || '').toLowerCase();
}

function normaliseStatus(status) {
  const val = normaliseKey(status);
  return VALID_STATUSES.includes(val) ? val : null;
}

function ensureBaseIntegration(list, key, label) {
  const slug = normaliseKey(key);
  const idx = list.findIndex((item) => normaliseKey(item.key) === slug);
  const existing = idx >= 0 ? list[idx] : null;
  const payload = {
    key: slug,
    label: label || existing?.label || key,
    status: existing?.status || 'not_connected',
    lastCheckedAt: existing?.lastCheckedAt || null,
    metadata: existing?.metadata || {}
  };

  if (idx >= 0) list[idx] = { ...existing, ...payload };
  else list.push(payload);
}

function sanitiseInstitution(raw = {}) {
  const id = String(raw.id || '').trim();
  const providerId = String(raw.providerId || raw.provider_id || '').trim();
  const providers = Array.isArray(raw.providers)
    ? raw.providers.map((value) => String(value || '').trim()).filter(Boolean)
    : [];

  return {
    id: id ? id.toLowerCase() : '',
    providerId: providerId || (id.startsWith('uk-') ? id : ''),
    providers,
    name: String(raw.name || '').trim(),
    brandColor: raw.brandColor || null,
    accentColor: raw.accentColor || null,
    icon: raw.icon || null,
    tagline: raw.tagline || null
  };
}

function buildConnectionKey(provider, slug) {
  return `${normaliseKey(provider)}:${String(slug).toLowerCase()}`;
}

function randomSuffix() {
  return crypto.randomBytes(5).toString('hex');
}

function pruneSessions(sessions = [], minutes = 30) {
  const cutoff = Date.now() - (1000 * 60 * minutes);
  return sessions.filter((session) => {
    const created = new Date(session.createdAt || Date.now()).getTime();
    return created > cutoff;
  });
}

module.exports = {
  VALID_STATUSES,
  normaliseKey,
  normaliseStatus,
  ensureBaseIntegration,
  sanitiseInstitution,
  buildConnectionKey,
  randomSuffix,
  pruneSessions
};
