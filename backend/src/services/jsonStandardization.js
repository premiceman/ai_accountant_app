'use strict';

const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
const { callOpenAIJson } = require('./documents/openaiClient');

dayjs.extend(customParseFormat);

const MONTH_YEAR_REGEX = /^(0[1-9]|1[0-2])\/\d{4}$/;
const VALUE_CANDIDATE_KEYS = ['date', 'value', 'text', 'raw', 'formatted'];
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

function createAccessor(container, key, value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return {
      value: trimmed,
      setValue(newValue) {
        container[key] = newValue;
      },
    };
  }

  if (isPlainObject(value)) {
    for (const candidateKey of VALUE_CANDIDATE_KEYS) {
      if (typeof value[candidateKey] === 'string') {
        const trimmed = value[candidateKey].trim();
        if (trimmed) {
          return {
            value: trimmed,
            setValue(newValue) {
              value[candidateKey] = newValue;
            },
          };
        }
      }
    }
  }

  return null;
}

function findMatchingAccessor(source, predicate, depth = 0) {
  if (!isPlainObject(source) || depth > 2) return null;

  for (const [key, value] of Object.entries(source)) {
    const lowerKey = key.toLowerCase();
    if (predicate(lowerKey)) {
      const accessor = createAccessor(source, key, value);
      if (accessor) return accessor;
    }
    if (isPlainObject(value)) {
      const nested = findMatchingAccessor(value, predicate, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

function extractPeriodAccessors(period) {
  const dateAccessor = findMatchingAccessor(period, (key) => {
    if (key === 'date' || key === 'perioddate') return true;
    return key.includes('date') && !key.includes('start') && !key.includes('end');
  });
  const startAccessor = findMatchingAccessor(period, (key) => key.includes('start') || key.includes('from'));
  const endAccessor = findMatchingAccessor(period, (key) => key.includes('end') || key.includes('to'));

  return { dateAccessor, startAccessor, endAccessor };
}

function selectFirstAccessor(...accessors) {
  for (const accessor of accessors) {
    if (accessor && accessor.value) return accessor;
  }
  return null;
}

const LOCAL_PARSE_FORMATS = [
  'DD MMM YYYY',
  'D MMM YYYY',
  'DD MMMM YYYY',
  'D MMMM YYYY',
  'YYYY-MM-DD',
  'YYYY/MM/DD',
  'YYYY.MM.DD',
  'DD/MM/YYYY',
  'D/M/YYYY',
  'DD-MM-YYYY',
  'D-M-YYYY',
  'MM/DD/YYYY',
  'M/D/YYYY',
  'MM-DD-YYYY',
  'M-D-YYYY',
  'MMMM YYYY',
  'MMM YYYY',
  'YYYY MMM',
  'YYYY MMMM',
  'YYYYMMDD',
];

function tryNormalizeMonthYear(value) {
  if (!value || typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (MONTH_YEAR_REGEX.test(trimmed)) return trimmed;

  const compact = trimmed.replace(/\s+/g, ' ');

  for (const format of LOCAL_PARSE_FORMATS) {
    const parsed = dayjs(compact, format, true);
    if (parsed.isValid()) {
      return parsed.format('MM/YYYY');
    }
  }

  const isoMonthMatch = /^(\d{4})[-/](0[1-9]|1[0-2])$/.exec(compact);
  if (isoMonthMatch) {
    return `${isoMonthMatch[2]}/${isoMonthMatch[1]}`;
  }

  const monthIsoMatch = /^(0[1-9]|1[0-2])[-/](\d{4})$/.exec(compact);
  if (monthIsoMatch) {
    return `${monthIsoMatch[1]}/${monthIsoMatch[2]}`;
  }

  const fallback = dayjs(compact);
  if (fallback.isValid()) {
    return fallback.format('MM/YYYY');
  }

  return null;
}

async function requestMonthYear({ docType, rawValue, startValue, endValue }) {
  const candidates = [rawValue, endValue, startValue];

  for (const candidate of candidates) {
    const normalized = tryNormalizeMonthYear(candidate);
    if (normalized) return normalized;
  }

  if (!candidates.some((candidate) => typeof candidate === 'string' && candidate.trim())) {
    throw new Error('No period date value available');
  }

  const system = `You convert ${docType} period dates into the MM/YYYY format.`;
  const contextLines = ['Return the month and year as digits in the MM/YYYY format.'];

  if (rawValue && rawValue.trim()) {
    contextLines.unshift(`Primary value: ${rawValue}`);
  }
  if (startValue && startValue.trim()) {
    contextLines.push(`Period start: ${startValue}`);
  }
  if (endValue && endValue.trim()) {
    contextLines.push(`Period end: ${endValue}`);
  }

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

  const { dateAccessor, startAccessor, endAccessor } = extractPeriodAccessors(period);
  const sourceAccessor = selectFirstAccessor(dateAccessor, endAccessor, startAccessor);
  if (!sourceAccessor) throw new Error('Unable to determine payslip period date');

  const normalized = await requestMonthYear({
    docType: 'payslip',
    rawValue: sourceAccessor.value,
    startValue: startAccessor ? startAccessor.value : null,
    endValue: endAccessor ? endAccessor.value : null,
  });

  assignPeriodDateValue(period, normalized, dateAccessor || null);
}

function assignPeriodDateValue(period, value, dateAccessor) {
  if (dateAccessor) {
    dateAccessor.setValue(value);
    return;
  }

  const exactDateKey = Object.keys(period).find((key) => key.toLowerCase() === 'date');
  if (exactDateKey) {
    period[exactDateKey] = value;
    return;
  }

  const fallbackKey = Object.keys(period).find((key) => {
    const lower = key.toLowerCase();
    return lower.includes('date') && !lower.includes('start') && !lower.includes('end');
  });

  if (fallbackKey) {
    period[fallbackKey] = value;
    return;
  }

  period.Date = value;
}

async function standardizeStatement(data) {
  const period = isPlainObject(data.period) ? data.period : null;
  if (!period) throw new Error('Statement JSON missing period data');

  const { dateAccessor, startAccessor, endAccessor } = extractPeriodAccessors(period);
  const sourceAccessor = selectFirstAccessor(dateAccessor, endAccessor, startAccessor);
  if (!sourceAccessor) throw new Error('Unable to determine statement period date');

  const normalized = await requestMonthYear({
    docType: 'statement',
    rawValue: sourceAccessor.value,
    startValue: startAccessor ? startAccessor.value : null,
    endValue: endAccessor ? endAccessor.value : null,
  });

  assignPeriodDateValue(period, normalized, dateAccessor || null);
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
