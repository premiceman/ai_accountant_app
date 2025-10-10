'use strict';

const dayjs = require('dayjs');

function normaliseText(value) {
  return String(value || '').toLowerCase();
}

function normaliseName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function buildUserNameSet(user = {}) {
  const names = new Set();
  const add = (value) => {
    const norm = normaliseName(value);
    if (norm) names.add(norm);
  };
  if (!user || typeof user !== 'object') {
    return names;
  }
  add(user.fullName);
  add(user.preferredName);
  add(user.firstName);
  add(user.lastName);
  if (user.firstName && user.lastName) add(`${user.firstName} ${user.lastName}`);
  add(user.username);
  if (Array.isArray(user.aliases)) {
    user.aliases.forEach(add);
  }
  return names;
}

function nameMatchesUser(candidate, userSet) {
  const norm = normaliseName(candidate);
  if (!norm || !userSet || userSet.size === 0) return null;
  if (userSet.has(norm)) return true;
  for (const stored of userSet) {
    const tokens = stored.split(' ').filter(Boolean);
    if (tokens.length && tokens.every((token) => norm.includes(token))) {
      return true;
    }
  }
  return false;
}

function firstValidDate(...values) {
  for (const value of values) {
    if (!value) continue;
    const parsed = dayjs(value);
    if (parsed.isValid()) return parsed;
  }
  return null;
}

function stampDocumentDate(target, dateValue) {
  const parsed = firstValidDate(dateValue);
  if (!parsed) return null;
  const iso = parsed.toISOString();
  target.metadata = target.metadata || {};
  target.metadata.documentDate = iso;
  target.metadata.documentMonth = parsed.format('YYYY-MM');
  target.metadata.documentMonthLabel = parsed.format('MM/YYYY');
  return iso;
}

module.exports = {
  normaliseText,
  normaliseName,
  buildUserNameSet,
  nameMatchesUser,
  firstValidDate,
  stampDocumentDate,
};
