'use strict';

function isObject(value) {
  return Boolean(value) && typeof value === 'object';
}

function parseDateValue(value) {
  if (!value && value !== 0) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const fromNumber = new Date(value);
    return Number.isNaN(fromNumber.getTime()) ? null : fromNumber;
  }

  const str = String(value).trim();
  if (!str) return null;

  // Handle already normalised values (MM/YYYY)
  const monthYearMatch = str.match(/^(0[1-9]|1[0-2])[\/-](\d{4})$/);
  if (monthYearMatch) {
    const month = Number(monthYearMatch[1]);
    const year = Number(monthYearMatch[2]);
    const date = new Date(Date.UTC(year, month - 1, 1));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // Handle ISO-like dates (YYYY-MM-DD...)
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const date = new Date(Date.UTC(year, month - 1, 1));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // Handle DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = str.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (dmyMatch) {
    const day = Number(dmyMatch[1]);
    const month = Number(dmyMatch[2]);
    const yearRaw = dmyMatch[3];
    const year = Number(yearRaw.length === 2 ? `20${yearRaw}` : yearRaw);
    if (Number.isFinite(day) && Number.isFinite(month) && Number.isFinite(year)) {
      const date = new Date(Date.UTC(year, month - 1, 1));
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }

  const parsed = new Date(str);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatMonthYear(date) {
  if (!(date instanceof Date)) return null;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  const mm = String(month + 1).padStart(2, '0');
  return `${mm}/${year}`;
}

function normaliseDateValue(value) {
  const date = parseDateValue(value);
  if (!date) return value;
  const formatted = formatMonthYear(date);
  return formatted || value;
}

function normaliseDateFields(payload) {
  if (!isObject(payload)) return payload;

  const seen = new WeakSet();

  function traverse(node) {
    if (!isObject(node) || seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      node.forEach(traverse);
      return;
    }

    for (const [key, value] of Object.entries(node)) {
      if (typeof key === 'string' && key.toLowerCase() === 'date') {
        node[key] = normaliseDateValue(value);
      }

      if (isObject(value)) {
        traverse(value);
      }
    }
  }

  traverse(payload);
  return payload;
}

module.exports = {
  normaliseDateFields,
  __private__: {
    parseDateValue,
    formatMonthYear,
    normaliseDateValue,
  },
};
