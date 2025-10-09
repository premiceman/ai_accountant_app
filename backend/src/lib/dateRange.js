// NOTE: Phase-2 — backfill v1 & add /api/analytics/v1/* endpoints. Legacy endpoints unchanged.
'use strict';

const { ensureIsoDate, ensureIsoMonth } = require('../../../shared/v1/index.js');

function parseIsoDate(value, fallback) {
  const iso = ensureIsoDate(value);
  if (iso) return iso;
  return fallback ?? null;
}

function normaliseRange({ start, end }) {
  const startIso = parseIsoDate(start, ensureIsoDate(new Date()));
  const endIso = parseIsoDate(end, startIso);
  if (!startIso || !endIso) {
    throw new Error('Invalid date range');
  }
  if (startIso > endIso) {
    throw new Error('Range start must be <= end');
  }
  return {
    start: startIso,
    end: endIso,
  };
}

function granularityToLabel(granularity) {
  if (granularity === 'quarter') return 'quarter';
  if (granularity === 'year') return 'year';
  return 'month';
}

function buildPeriod(start, end, granularity) {
  const range = normaliseRange({ start, end });
  return {
    start: range.start,
    end: range.end,
    granularity: granularityToLabel(granularity),
  };
}

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function bucketForGranularity(dateIso, granularity) {
  const date = toDate(dateIso);
  if (!date) return null;
  if (granularity === 'day') {
    return date.toISOString().slice(0, 10);
  }
  if (granularity === 'week') {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = d.getUTCDay();
    const diff = (day === 0 ? -6 : 1) - day; // Monday as start
    d.setUTCDate(d.getUTCDate() + diff);
    return d.toISOString().slice(0, 10);
  }
  // month
  return ensureIsoMonth(date);
}

function enumerateBuckets({ start, end }, granularity) {
  const startDate = toDate(start);
  const endDate = toDate(end);
  if (!startDate || !endDate) return [];
  const points = [];
  const cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()));
  while (cursor <= endDate) {
    if (granularity === 'day') {
      points.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    } else if (granularity === 'week') {
      points.push(bucketForGranularity(cursor.toISOString().slice(0, 10), 'week'));
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    } else {
      points.push(ensureIsoMonth(cursor));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }
  return Array.from(new Set(points));
}

module.exports = {
  normaliseRange,
  buildPeriod,
  bucketForGranularity,
  enumerateBuckets,
};
