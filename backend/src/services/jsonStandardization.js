'use strict';

const { callOpenAIJson } = require('./documents/openaiClient');

const MONTH_YEAR_REGEX = /^(0[1-9]|1[0-2])\/\d{4}$/;
const DEFAULT_SCHEMA = {
  name: 'period_month_year',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      date: { type: 'string', pattern: MONTH_YEAR_REGEX.source },
    },
    required: ['date'],
  },
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clonePayload(payload) {
  return JSON.parse(JSON.stringify(payload));
}

function extractStringValue(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (isPlainObject(value)) {
    const keys = ['date', 'value', 'text', 'raw', 'formatted'];
    for (const key of keys) {
      if (typeof value[key] === 'string') {
        const trimmed = value[key].trim();
        if (trimmed) return trimmed;
      }
    }
  }
  return null;
}

function findMatchingValue(source, predicate, depth = 0) {
  if (!isPlainObject(source) || depth > 2) return null;

  for (const [key, value] of Object.entries(source)) {
    const lowerKey = key.toLowerCase();
    if (predicate(lowerKey)) {
      const extracted = extractStringValue(value);
      if (extracted) return extracted;
    }
    if (isPlainObject(value)) {
      const nested = findMatchingValue(value, predicate, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

function extractPeriodValues(period) {
  const dateValue = findMatchingValue(period, (key) => {
    if (key === 'date' || key === 'perioddate') return true;
    return key.includes('date') && !key.includes('start') && !key.includes('end');
  });
  const startValue = findMatchingValue(period, (key) => key.includes('start') || key.includes('from'));
  const endValue = findMatchingValue(period, (key) => key.includes('end') || key.includes('to'));

  return { dateValue, startValue, endValue };
}

async function requestMonthYear({ docType, rawValue, startValue, endValue }) {
  if (!rawValue) throw new Error('No period date value available');

  const system = `You convert ${docType} period dates into the MM/YYYY format.`;
  const contextLines = [
    `Primary value: ${rawValue}`,
    'Return the month and year as digits in the MM/YYYY format.',
  ];
  if (startValue) contextLines.push(`Period start: ${startValue}`);
  if (endValue) contextLines.push(`Period end: ${endValue}`);

  const response = await callOpenAIJson({
    system,
    user: contextLines.join('\n'),
    schema: DEFAULT_SCHEMA,
    maxTokens: 32,
  });

  if (!response || typeof response.date !== 'string') {
    throw new Error('Unable to standardise period date');
  }

  const result = response.date.trim();
  if (!MONTH_YEAR_REGEX.test(result)) {
    throw new Error('Unable to standardise period date');
  }

  return result;
}

async function standardizePayslip(data) {
  const period = isPlainObject(data.period) ? data.period : null;
  if (!period) throw new Error('Payslip JSON missing period data');

  const { dateValue, startValue, endValue } = extractPeriodValues(period);
  const rawValue = dateValue || startValue || endValue;
  if (!rawValue) throw new Error('Unable to determine payslip period date');

  const normalized = await requestMonthYear({
    docType: 'payslip',
    rawValue,
    startValue,
    endValue,
  });

  period.date = normalized;
}

function assignEndPeriodValue(period, value) {
  period.endDate = value;
}

async function standardizeStatement(data) {
  const period = isPlainObject(data.period) ? data.period : null;
  if (!period) throw new Error('Statement JSON missing period data');

  const { dateValue, startValue, endValue } = extractPeriodValues(period);
  const rawValue = endValue || dateValue || startValue;
  if (!rawValue) throw new Error('Unable to determine statement period date');

  const normalized = await requestMonthYear({
    docType: 'statement',
    rawValue,
    startValue,
    endValue,
  });

  period.date = normalized;
  assignEndPeriodValue(period, normalized);
}

async function standardizeDocupipePayload(payload, { docType }) {
  if (!isPlainObject(payload)) {
    throw new Error('Payload must be an object');
  }

  const normalizedType = (docType || '').toLowerCase();
  const clone = clonePayload(payload);
  const dataSection = isPlainObject(clone.data) ? clone.data : clone;

  if (!isPlainObject(dataSection)) {
    throw new Error('DocuPipe payload missing data section');
  }

  if (normalizedType === 'payslip') {
    await standardizePayslip(dataSection);
  } else if (normalizedType === 'bank' || normalizedType === 'statement') {
    await standardizeStatement(dataSection);
  }

  return clone;
}

module.exports = {
  standardizeDocupipePayload,
};
