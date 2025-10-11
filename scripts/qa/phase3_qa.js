// NOTE: Hotfix — TS types for shared flags + FE v1 flip + staged loader + prefer-v1 legacy; aligns with Phase-1/2/3 specs. Additive, non-breaking.
// NOTE: QA Harness for Phase-3 — validates /api/analytics/v1, flags, caching, staged loader "failed". Non-breaking.
'use strict';

const { performance } = require('perf_hooks');
const { URL } = require('url');
const util = require('util');

const {
  canonicalCategories,
  validateDashboardSummaryV1,
  validateAnalyticsCategoriesV1,
  validateAnalyticsLargestExpensesV1,
  validateAnalyticsAccountsV1,
  validateAnalyticsTimeseriesV1,
} = require('../../shared/v1/index.js');
const { readFlag, toBoolean } = require('../../shared/config/featureFlags.js');

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH_RE = /^\d{4}-\d{2}$/;

const CURRENT_YEAR = new Date().getUTCFullYear();
const DEFAULTS = Object.freeze({
  base: 'http://localhost:3000',
  start: `${CURRENT_YEAR}-01-01`,
  end: `${CURRENT_YEAR}-12-31`,
  granularity: 'year',
  token: null,
});

function parseArgs(argv) {
  const options = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (!arg.startsWith('--')) continue;
    const [key, maybeValue] = arg.split('=');
    const next = typeof maybeValue === 'string' && maybeValue.length > 0 ? maybeValue : argv[i + 1];
    const consumeNext = maybeValue == null || maybeValue.length === 0;
    switch (key) {
      case '--base':
        if (consumeNext) i += 1;
        options.base = next ?? options.base;
        break;
      case '--start':
        if (consumeNext) i += 1;
        options.start = next ?? options.start;
        break;
      case '--end':
        if (consumeNext) i += 1;
        options.end = next ?? options.end;
        break;
      case '--granularity':
        if (consumeNext) i += 1;
        options.granularity = next ?? options.granularity;
        break;
      case '--token':
        if (consumeNext) i += 1;
        options.token = next ?? null;
        break;
      default:
        console.warn(`⚠️  Unknown option ${arg}`);
        if (consumeNext) i += 1;
    }
  }
  return options;
}

function printHelp() {
  console.log(`Phase-3 Analytics QA Harness\n\nUsage:\n  node scripts/qa/phase3_qa.js [options]\n\nOptions:\n  --base=<url>          Base URL for API (default: ${DEFAULTS.base})\n  --start=<YYYY-MM-DD>  Range start (default: ${DEFAULTS.start})\n  --end=<YYYY-MM-DD>    Range end (default: ${DEFAULTS.end})\n  --granularity=<g>     Summary granularity (year|quarter|month) (default: ${DEFAULTS.granularity})\n  --token=<jwt>         Optional bearer token for Authorization header\n  --help                Show this message\n\nExample:\n  node scripts/qa/phase3_qa.js --base=http://localhost:3000 --start=2025-01-01 --end=2025-12-31 --granularity=year\n`);
}

function readFeatureFlag(name) {
  const raw = readFlag(name);
  return {
    raw,
    enabled: toBoolean(raw),
  };
}

function isoDate(value) {
  if (typeof value !== 'string') return false;
  return ISO_DATE_RE.test(value);
}

function isoMonth(value) {
  if (typeof value !== 'string') return false;
  return ISO_MONTH_RE.test(value);
}

function isInteger(value) {
  return Number.isInteger(value);
}

function summariseErrors(errors) {
  if (!errors || !errors.length) return 'validation failed';
  return errors
    .slice(0, 3)
    .map((err) => {
      if (typeof err === 'string') return err;
      if (err.instancePath || err.message) {
        return `${err.instancePath || err.keyword || 'schema'}: ${err.message || util.inspect(err)}`;
      }
      return util.inspect(err);
    })
    .join('; ');
}

async function fetchJson(base, path, options) {
  const url = new URL(path, base);
  const headers = { 'content-type': 'application/json' };
  if (options?.token) {
    headers.Authorization = options.token.startsWith('Bearer ')
      ? options.token
      : `Bearer ${options.token}`;
  }
  const requestInit = {
    method: options?.method || 'GET',
    headers,
  };
  if (options?.body) {
    requestInit.body = JSON.stringify(options.body);
  }
  const start = performance.now();
  let response;
  try {
    response = await fetch(url, requestInit);
  } catch (error) {
    return {
      ok: false,
      status: 0,
      durationMs: performance.now() - start,
      error,
    };
  }
  const durationMs = performance.now() - start;
  let data = null;
  try {
    if (response.headers.get('content-type')?.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      data = text ? { text } : null;
    }
  } catch (error) {
    return {
      ok: false,
      status: response.status,
      durationMs,
      error,
    };
  }
  return {
    ok: response.ok,
    status: response.status,
    durationMs,
    headers: response.headers,
    data,
  };
}

function validateSummary(payload) {
  const valid = validateDashboardSummaryV1(payload);
  const notes = [];
  let passed = valid;
  if (!valid) {
    notes.push(summariseErrors(validateDashboardSummaryV1.errors));
  }
  if (!payload || typeof payload !== 'object') {
    notes.push('summary payload missing');
    return { passed: false, notes };
  }
  const totals = payload.totals || {};
  ['incomeMinor', 'spendMinor', 'netMinor'].forEach((key) => {
    if (!isInteger(totals[key])) {
      passed = false;
      notes.push(`totals.${key} must be integer`);
    }
  });
  if (!isoDate(payload?.period?.start) || !isoDate(payload?.period?.end)) {
    passed = false;
    notes.push('period start/end must be ISO YYYY-MM-DD');
  }
  return { passed, notes };
}

function validateCategories(payload) {
  const valid = validateAnalyticsCategoriesV1(payload);
  const notes = [];
  let passed = valid;
  if (!valid) {
    notes.push(summariseErrors(validateAnalyticsCategoriesV1.errors));
  }
  const seenInvalid = [];
  (payload?.categories || []).forEach((item) => {
    if (!canonicalCategories.includes(item.category)) {
      passed = false;
      seenInvalid.push(item.category);
    }
    if (!isInteger(item.outflowMinor)) {
      passed = false;
      notes.push(`category ${item.category} outflow not integer`);
    }
  });
  if (seenInvalid.length) {
    notes.push(`unexpected categories: ${seenInvalid.join(', ')}`);
  }
  return { passed, notes };
}

function validateLargestExpenses(payload) {
  const valid = validateAnalyticsLargestExpensesV1(payload);
  const notes = [];
  let passed = valid;
  if (!valid) {
    notes.push(summariseErrors(validateAnalyticsLargestExpensesV1.errors));
  }
  (payload?.items || []).forEach((item) => {
    if (!isoDate(item.date)) {
      passed = false;
      notes.push(`expense ${item.description || ''} date invalid`);
    }
    if (!isInteger(item.amountMinor)) {
      passed = false;
      notes.push('expense amount not integer');
    }
  });
  return { passed, notes };
}

function validateAccounts(payload) {
  const valid = validateAnalyticsAccountsV1(payload);
  const notes = [];
  let passed = valid;
  if (!valid) {
    notes.push(summariseErrors(validateAnalyticsAccountsV1.errors));
  }
  (payload?.accounts || []).forEach((acct) => {
    if (!isInteger(acct.incomeMinor) || acct.incomeMinor < 0) {
      passed = false;
      notes.push(`account ${acct.accountId} income invalid`);
    }
    if (!isInteger(acct.spendMinor) || acct.spendMinor < 0) {
      passed = false;
      notes.push(`account ${acct.accountId} spend invalid`);
    }
  });
  return { passed, notes };
}

function validateTimeseries(payload) {
  const valid = validateAnalyticsTimeseriesV1(payload);
  const notes = [];
  let passed = valid;
  if (!valid) {
    notes.push(summariseErrors(validateAnalyticsTimeseriesV1.errors));
  }
  (payload?.series || []).forEach((point) => {
    if (!isoDate(point.ts) && !isoMonth(point.ts)) {
      passed = false;
      notes.push(`series ts invalid: ${point.ts}`);
    }
    if (!isInteger(point.valueMinor)) {
      passed = false;
      notes.push('series value not integer');
    }
  });
  return { passed, notes };
}

async function main() {
  if (typeof fetch !== 'function') {
    console.error('Global fetch API unavailable. Run with Node.js 18+ or enable experimental fetch.');
    return 1;
  }
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return 0;
  }

  console.log('--- Phase-3 Analytics QA Harness ---');
  console.log(`Base URL: ${options.base}`);
  console.log(`Range: ${options.start} → ${options.end} (granularity=${options.granularity})`);
  if (options.token) {
    console.log('Authorization: Bearer <redacted>');
  }

  const flags = [
    'ENABLE_FRONTEND_ANALYTICS_V1',
    'ENABLE_AJV_STRICT',
    'ENABLE_ANALYTICS_LEGACY',
    'ENABLE_STAGED_LOADER_ANALYTICS',
    'ENABLE_QA_DEV_ENDPOINTS',
  ].map((name) => [name, readFeatureFlag(name)]);

  console.log('\nFeature Flags:');
  flags.forEach(([name, value]) => {
    console.log(`  ${name} = ${value.raw} (${value.enabled ? 'enabled' : 'disabled'})`);
  });

  const clientFlags = await fetchJson(options.base, '/api/flags', { token: options.token });
  if (clientFlags.ok) {
    console.log('\nBrowser-visible Flags:');
    Object.entries(clientFlags.data || {}).forEach(([key, value]) => {
      console.log(`  ${key} = ${value ? 'enabled' : 'disabled'}`);
    });
  } else {
    console.log('\nBrowser-visible Flags: unavailable');
  }

  const summaryRows = [];
  let hasFailure = false;

  const endpoints = [
    {
      name: 'analytics.summary',
      path: `/api/analytics/v1/summary?start=${encodeURIComponent(options.start)}&end=${encodeURIComponent(options.end)}&granularity=${encodeURIComponent(options.granularity)}`,
      validator: validateSummary,
    },
    {
      name: 'analytics.categories',
      path: `/api/analytics/v1/categories?start=${encodeURIComponent(options.start)}&end=${encodeURIComponent(options.end)}`,
      validator: validateCategories,
    },
    {
      name: 'analytics.largest-expenses',
      path: `/api/analytics/v1/largest-expenses?start=${encodeURIComponent(options.start)}&end=${encodeURIComponent(options.end)}&limit=10`,
      validator: validateLargestExpenses,
    },
    {
      name: 'analytics.accounts',
      path: `/api/analytics/v1/accounts?start=${encodeURIComponent(options.start)}&end=${encodeURIComponent(options.end)}`,
      validator: validateAccounts,
    },
    {
      name: 'analytics.timeseries',
      path: `/api/analytics/v1/timeseries?metric=spend&granularity=month&start=${encodeURIComponent(options.start)}&end=${encodeURIComponent(options.end)}`,
      validator: validateTimeseries,
    },
  ];

  for (const spec of endpoints) {
    const result = await fetchJson(options.base, spec.path, { token: options.token });
    const notes = [];
    let validated = false;
    if (!result.ok) {
      hasFailure = true;
      notes.push(result.error ? `request failed: ${result.error.message}` : `status ${result.status}`);
    }
    if (result.data && spec.validator) {
      const validation = spec.validator(result.data);
      validated = validation.passed;
      notes.push(...validation.notes);
      if (!validation.passed) {
        hasFailure = true;
      }
    }
    if (!result.ok && result.data && !validated) {
      notes.push(util.inspect(result.data, { depth: 3 }));
    }
    const row = {
      endpoint: spec.name,
      status: result.status,
      durationMs: result.durationMs?.toFixed(1) ?? 'n/a',
      validated: validated ? 'yes' : 'no',
      notes: notes.filter(Boolean).join(' | ') || 'ok',
    };
    summaryRows.push(row);
    if (spec.name === 'analytics.summary' && result.ok) {
      const repeat = await fetchJson(options.base, spec.path, { token: options.token });
      const improvement = repeat.durationMs && result.durationMs
        ? ((result.durationMs - repeat.durationMs) / result.durationMs) * 100
        : 0;
      const cacheHeader = repeat.headers?.get('x-analytics-v1-cache');
      const cacheNote = cacheHeader === 'hit' || improvement >= 30
        ? `cache: likely (Δ=${improvement.toFixed(1)}%)`
        : `cache: unclear (Δ=${improvement.toFixed(1)}%)`;
      if (!repeat.ok) {
        hasFailure = true;
      }
      summaryRows.push({
        endpoint: 'analytics.summary (repeat)',
        status: repeat.status,
        durationMs: repeat.durationMs?.toFixed(1) ?? 'n/a',
        validated: repeat.ok ? 'n/a' : 'no',
        notes: repeat.ok ? cacheNote : `repeat failed (${repeat.status})`,
      });
    }
  }

  const invalidResponse = await fetchJson(options.base, '/__qa__/emitInvalidV1', { token: options.token });
  if (!invalidResponse.ok) {
    hasFailure = true;
    summaryRows.push({
      endpoint: '__qa__/emitInvalidV1',
      status: invalidResponse.status,
      durationMs: invalidResponse.durationMs?.toFixed(1) ?? 'n/a',
      validated: 'no',
      notes: invalidResponse.error ? invalidResponse.error.message : 'failed to fetch invalid sample',
    });
  } else {
    const postResult = await fetchJson(options.base, '/__qa__/validate/summary', {
      method: 'POST',
      body: invalidResponse.data,
      token: options.token,
    });
    const expect422 = postResult.status === 422;
    let validationOk = false;
    let notes = 'ok';
    if (!expect422) {
      hasFailure = true;
      notes = `expected 422, got ${postResult.status}`;
    } else if (!postResult.data || postResult.data.code !== 'SCHEMA_VALIDATION_FAILED') {
      hasFailure = true;
      notes = 'missing SCHEMA_VALIDATION_FAILED payload';
    } else if (!Array.isArray(postResult.data.details) || postResult.data.details.length === 0) {
      hasFailure = true;
      notes = 'Ajv errors missing';
    } else {
      validationOk = true;
      notes = '422 with Ajv errors';
    }
    summaryRows.push({
      endpoint: '__qa__/validate/summary',
      status: postResult.status,
      durationMs: postResult.durationMs?.toFixed(1) ?? 'n/a',
      validated: validationOk ? 'yes' : 'no',
      notes,
    });
  }

  console.log('\nQA Summary:');
  const headers = ['Endpoint', 'Status', 'Duration (ms)', 'Validated', 'Notes'];
  console.log(headers.join(' | '));
  console.log(headers.map(() => '---').join(' | '));
  summaryRows.forEach((row) => {
    console.log(
      `${row.endpoint} | ${row.status ?? 'n/a'} | ${row.durationMs} | ${row.validated} | ${row.notes}`
    );
  });

  if (hasFailure) {
    console.error('\n❌ QA harness detected failures.');
    return 1;
  }
  console.log('\n✅ QA harness completed without failures.');
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error('Unexpected error running QA harness', error);
    process.exit(1);
  });
