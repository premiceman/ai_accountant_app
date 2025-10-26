// NOTE: Hotfix — TS types for shared flags + FE v1 flip + staged loader + prefer-v1 legacy; aligns with Phase-1/2/3 specs. Additive, non-breaking.
// NOTE: Phase-2 — backfill v1 & add /api/analytics/v1/* endpoints. Legacy endpoints unchanged.
// backend/routes/analytics.js
const express = require('express');
const dayjs = require('dayjs');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const User = require('../models/User');
const DocumentInsight = require('../models/DocumentInsight');
const { applyDocumentInsights, setInsightsProcessing } = require('../src/services/documents/insightsStore');
const { rebuildMonthlyAnalytics } = require('../src/services/vault/analytics');
const { paths, readJsonSafe } = require('../src/store/jsondb');
const { featureFlags } = require('../src/lib/featureFlags');
const { preferV1 } = require('../src/lib/analyticsV1');

const router = express.Router();
try {
  // lazily require to avoid circular deps when worker package not installed
  const analyticsV1Router = require('../src/routes/analytics.v1.routes.js');
  if (analyticsV1Router) {
    router.use('/v1', analyticsV1Router);
  }
} catch (error) {
  console.warn('⚠️  analytics v1 routes unavailable', error?.message || error);
}

if (!featureFlags.enableAnalyticsLegacy) {
  router.use((req, res, next) => {
    if (req.path.startsWith('/v1')) return next();
    return res.status(404).json({ error: 'Legacy analytics disabled' });
  });
}

// TODO(analytics-cache): Swap range parsing + payload assembly to read from AnalyticsCache
// and trigger background recompute via /_internal/analytics/recompute (see docs/compatibility-map.md).

/** @deprecated Legacy analytics dashboard endpoints retained for rollback. */

const REQUIRED_DOC_TYPES = [
  { type: 'p60', label: 'P60' },
  { type: 'p45', label: 'P45 / starter checklist' },
  { type: 'bank_statement', label: 'Bank statements' },
  { type: 'id', label: 'Photo ID' },
  { type: 'utr', label: 'UTR or HMRC letter' }
];

const money = (n) => Number(n || 0);

const preferredCache = new WeakMap();

function getPreferredInsight(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (preferredCache.has(entry)) return preferredCache.get(entry);
  const preferred = preferV1(entry);
  preferredCache.set(entry, preferred);
  return preferred;
}

function toMajor(minor) {
  if (minor == null) return null;
  const value = Number(minor);
  if (!Number.isFinite(value)) return null;
  return Math.round(value) / 100;
}

function mergePayslipMetrics(legacyMetrics = {}, preferredMetrics = null) {
  const merged = { ...(legacyMetrics || {}) };
  if (!preferredMetrics) {
    if (merged.totalDeductions == null && Array.isArray(merged.deductions)) {
      merged.totalDeductions = merged.deductions.reduce((acc, item) => acc + Number(item.amount || 0), 0);
    }
    if (merged.takeHomePercent == null && merged.gross) {
      const netValue = Number(merged.net ?? 0);
      merged.takeHomePercent = merged.gross ? netValue / Number(merged.gross || 1) : null;
    }
    if (merged.effectiveMarginalRate == null && merged.gross) {
      const deductionsValue = Number(merged.totalDeductions ?? 0);
      merged.effectiveMarginalRate = merged.gross ? deductionsValue / Number(merged.gross || 1) : null;
    }
    return merged;
  }
  if (preferredMetrics.payDate) merged.payDate = preferredMetrics.payDate;
  if (preferredMetrics.period?.start) merged.periodStart = preferredMetrics.period.start;
  if (preferredMetrics.period?.end) merged.periodEnd = preferredMetrics.period.end;
  if (preferredMetrics.period?.month) merged.periodMonth = preferredMetrics.period.month;
  if (preferredMetrics.period) {
    merged.period = {
      ...(merged.period || {}),
      start: preferredMetrics.period.start || merged.period?.start || null,
      end: preferredMetrics.period.end || merged.period?.end || null,
      month: preferredMetrics.period.month || merged.period?.month || null,
    };
  }
  if (preferredMetrics.employer && !merged.employer) merged.employer = preferredMetrics.employer;
  if (preferredMetrics.taxCode) merged.taxCode = preferredMetrics.taxCode;
  const gross = toMajor(preferredMetrics.grossMinor);
  if (gross != null) merged.gross = gross;
  const net = toMajor(preferredMetrics.netMinor);
  if (net != null) merged.net = net;
  const tax = toMajor(preferredMetrics.taxMinor);
  if (tax != null) merged.tax = tax;
  const ni = toMajor(preferredMetrics.nationalInsuranceMinor);
  if (ni != null) {
    merged.ni = ni;
    merged.nationalInsurance = ni;
  }
  const pension = toMajor(preferredMetrics.pensionMinor);
  if (pension != null) merged.pension = pension;
  const studentLoan = toMajor(preferredMetrics.studentLoanMinor);
  if (studentLoan != null) merged.studentLoan = studentLoan;
  if (merged.totalDeductions == null && Array.isArray(merged.deductions)) {
    merged.totalDeductions = merged.deductions.reduce((acc, item) => acc + Number(item.amount || 0), 0);
  }
  if (merged.takeHomePercent == null && merged.gross) {
    const netValue = Number(merged.net ?? 0);
    merged.takeHomePercent = merged.gross ? netValue / Number(merged.gross || 1) : null;
  }
  if (merged.effectiveMarginalRate == null && merged.gross) {
    const deductionsValue = Number(merged.totalDeductions ?? 0);
    merged.effectiveMarginalRate = merged.gross ? deductionsValue / Number(merged.gross || 1) : null;
  }
  return merged;
}

function mergeStatementMetrics(legacyMetrics = {}, preferredMetrics = null) {
  const merged = { ...(legacyMetrics || {}) };
  if (!preferredMetrics) {
    if (merged.totals?.income == null && merged.income != null) {
      merged.totals = merged.totals || {};
      merged.totals.income = merged.income;
    }
    if (merged.totals?.spend == null && merged.spend != null) {
      merged.totals = merged.totals || {};
      merged.totals.spend = merged.spend;
    }
    if (merged.totals?.net == null && merged.totals?.income != null && merged.totals?.spend != null) {
      merged.totals.net = Number(merged.totals.income || 0) - Number(merged.totals.spend || 0);
    }
    return merged;
  }
  if (preferredMetrics.period?.start) merged.periodStart = preferredMetrics.period.start;
  if (preferredMetrics.period?.end) merged.periodEnd = preferredMetrics.period.end;
  if (preferredMetrics.period?.month) merged.periodMonth = preferredMetrics.period.month;
  if (preferredMetrics.period) {
    merged.period = {
      ...(merged.period || {}),
      start: preferredMetrics.period.start || merged.period?.start || null,
      end: preferredMetrics.period.end || merged.period?.end || null,
      month: preferredMetrics.period.month || merged.period?.month || null,
    };
  }
  const inflows = toMajor(preferredMetrics.inflowsMinor);
  const outflows = toMajor(preferredMetrics.outflowsMinor);
  const net = toMajor(preferredMetrics.netMinor);
  if (!merged.totals) merged.totals = {};
  if (inflows != null) {
    merged.income = inflows;
    merged.totals.income = inflows;
  }
  if (outflows != null) {
    merged.spend = outflows;
    merged.totals.spend = outflows;
  }
  if (net != null) merged.net = net;
  if (merged.totals?.net == null && merged.totals?.income != null && merged.totals?.spend != null) {
    merged.totals.net = Number(merged.totals.income || 0) - Number(merged.totals.spend || 0);
  }
  return merged;
}

function convertPreferredTransactions(transactions = [], baseKey = 'statement') {
  return transactions.map((tx, index) => {
    const amountMinor = Number(tx?.amountMinor ?? 0);
    const absMajor = Math.round(Math.abs(amountMinor)) / 100;
    const direction = tx?.direction === 'outflow' ? 'outflow' : 'inflow';
    const signed = direction === 'outflow' ? -absMajor : absMajor;
    const category = tx?.category || 'Other';
    const accountId = tx?.accountId || tx?.account || null;
    return {
      amount: signed,
      direction,
      description: tx?.description || tx?.originalDescription || 'Transaction',
      category,
      date: tx?.date || null,
      transfer: Boolean(tx?.transfer || category === 'Transfers'),
      accountId,
      accountName: tx?.accountName || tx?.account || null,
      __id: tx?.id || `${baseKey}:${index}`,
    };
  });
}

function enrichInsight(entry, key) {
  if (!entry || typeof entry !== 'object') return entry;
  const preferred = getPreferredInsight(entry);
  const clone = { ...entry, __preferred: preferred };
  if (entry.metadata) clone.metadata = { ...entry.metadata };
  if (preferred?.documentDate) {
    clone.metadata = clone.metadata || {};
    clone.metadata.documentDate = preferred.documentDate;
  }
  if (preferred?.documentMonth) {
    clone.metadata = clone.metadata || {};
    clone.metadata.documentMonth = preferred.documentMonth;
  }
  if (preferred?.currency) clone.currency = preferred.currency;
  const legacyMetrics = preferred?.legacyMetrics || entry.metrics || {};
  if (entry.catalogueKey === 'payslip') {
    clone.metrics = mergePayslipMetrics(legacyMetrics, preferred?.metricsV1);
  } else if (preferred?.metricsV1 && preferred.transactionsV1?.length) {
    clone.metrics = mergeStatementMetrics(legacyMetrics, preferred.metricsV1);
  } else if (legacyMetrics) {
    clone.metrics = { ...legacyMetrics };
  }
  if (preferred?.transactionsV1?.length) {
    clone.transactions = convertPreferredTransactions(preferred.transactionsV1, key || entry.key || entry.baseKey || 'entry');
  } else if (Array.isArray(preferred?.legacyTransactions)) {
    clone.transactions = preferred.legacyTransactions.map((tx) => ({ ...tx }));
  } else if (Array.isArray(entry.transactions)) {
    clone.transactions = entry.transactions.map((tx) => ({ ...tx }));
  }
  return clone;
}

function normaliseSourcesWithPreferred(sources = {}) {
  const result = {};
  for (const [key, value] of Object.entries(sources)) {
    if (!value) continue;
    result[key] = enrichInsight(value, key);
  }
  return result;
}

function normaliseMonthToken(token) {
  if (!token) return null;
  const raw = String(token).trim();
  if (!raw) return null;
  if (/^\d{2}\/\d{4}$/.test(raw)) {
    return raw;
  }
  const isoMonthMatch = raw.match(/^(\d{4})-(\d{2})$/);
  if (isoMonthMatch) {
    return `${isoMonthMatch[2]}/${isoMonthMatch[1]}`;
  }
  const slashMonthMatch = raw.match(/^(\d{4})\/(\d{2})$/);
  if (slashMonthMatch) {
    return `${slashMonthMatch[2]}/${slashMonthMatch[1]}`;
  }
  const parsed = dayjs(raw);
  if (parsed.isValid()) {
    return parsed.format('MM/YYYY');
  }
  return null;
}

function coercePeriodDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{2}\/\d{4}$/.test(raw)) {
    const [month, year] = raw.split('/');
    return toDate(`${year}-${month}-01`);
  }
  if (/^\d{4}\/\d{2}$/.test(raw)) {
    const [year, month] = raw.split('/');
    return toDate(`${year}-${month}-01`);
  }
  if (/^\d{4}-\d{2}$/.test(raw)) {
    return toDate(`${raw}-01`);
  }
  return toDate(raw);
}

function derivePeriodLabel(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const containers = [
    entry.metadata?.period,
    entry.period,
    entry.metrics?.period,
    entry.__preferred?.period,
    entry.__preferred?.metricsV1?.period,
  ];
  for (const container of containers) {
    if (!container) continue;
    if (typeof container === 'string') {
      const label = normaliseMonthToken(container);
      if (label) return label;
      continue;
    }
    if (typeof container === 'object') {
      const candidates = [
        container.month,
        container.Month,
        container.Date,
        container.date,
        container.label,
      ];
      for (const candidate of candidates) {
        const label = normaliseMonthToken(candidate);
        if (label) return label;
      }
    }
  }
  const extras = [
    entry.metadata?.documentMonth,
    entry.metadata?.periodMonth,
    entry.metrics?.periodMonth,
  ];
  for (const extra of extras) {
    const label = normaliseMonthToken(extra);
    if (label) return label;
  }
  const dateCandidates = [
    entry.metrics?.payDate,
    entry.metadata?.payDate,
    entry.metrics?.periodEnd,
    entry.metadata?.period?.end,
    entry.metrics?.period?.end,
    entry.period?.end,
    entry.metadata?.period?.start,
    entry.metrics?.period?.start,
    entry.period?.start,
    entry.metadata?.documentDate,
    entry.period?.Date,
    entry.metadata?.period?.Date,
    entry.__preferred?.metricsV1?.period?.end,
    entry.__preferred?.metricsV1?.period?.start,
    entry.__preferred?.documentDate,
  ];
  for (const candidate of dateCandidates) {
    const date = coercePeriodDate(candidate);
    if (date) {
      return dayjs(date).format('MM/YYYY');
    }
  }
  return null;
}

function entrySortTimestamp(entry) {
  if (!entry || typeof entry !== 'object') return 0;
  const candidates = [
    entry.metrics?.payDate,
    entry.metadata?.payDate,
    entry.metrics?.period?.end,
    entry.metadata?.period?.end,
    entry.period?.end,
    entry.metrics?.period?.start,
    entry.metadata?.period?.start,
    entry.period?.start,
    entry.period?.Date,
    entry.metadata?.period?.Date,
    entry.metadata?.documentMonth,
    entry.metadata?.documentDate,
    entry.metrics?.period?.month,
    entry.period?.month,
    entry.__preferred?.metricsV1?.period?.end,
    entry.__preferred?.metricsV1?.period?.start,
    entry.__preferred?.documentDate,
  ];
  for (const value of candidates) {
    const date = coercePeriodDate(value);
    if (date) return date.getTime();
  }
  if (Array.isArray(entry.files)) {
    for (const file of entry.files) {
      const date = coercePeriodDate(file?.uploadedAt);
      if (date) return date.getTime();
    }
  }
  return 0;
}

function latestEntry(entries = []) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  return entries
    .slice()
    .sort((a, b) => entrySortTimestamp(b) - entrySortTimestamp(a))[0] || null;
}

function cloneLineItems(items = []) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    label: item?.label || null,
    amount: item?.amount != null && Number.isFinite(Number(item.amount))
      ? Number(item.amount)
      : item?.amount ?? null,
    code: item?.code || null,
    type: item?.type || null,
  }));
}

function buildDocInsightsSummary(docSources = {}) {
  const grouped = groupSourcesByBase(docSources);

  const payslipEntries = Array.isArray(grouped.payslip) ? grouped.payslip : [];
  const payslipLatest = latestEntry(payslipEntries);
  const payslipMetrics = payslipLatest?.metrics || {};
  const payslipTotals = {};
  const totalKeys = ['gross', 'net', 'tax', 'nationalInsurance', 'ni', 'pension', 'studentLoan', 'totalDeductions'];
  totalKeys.forEach((key) => {
    if (payslipMetrics[key] == null) return;
    const value = Number(payslipMetrics[key]);
    payslipTotals[key] = Number.isFinite(value) ? value : payslipMetrics[key];
  });

  const statementEntries = Array.isArray(grouped.current_account_statement)
    ? grouped.current_account_statement
    : [];
  const statementRange = {
    start: new Date('1900-01-01T00:00:00Z'),
    end: new Date('2100-12-31T23:59:59Z'),
  };
  const statementSummary = summariseStatementRange(statementEntries, statementRange);
  const income = Number(statementSummary?.totals?.income || 0);
  const spend = Number(statementSummary?.totals?.spend || 0);
  const netRaw = statementSummary?.totals?.net;
  const net = netRaw != null && Number.isFinite(Number(netRaw)) ? Number(netRaw) : income - spend;
  const bankTotals = {
    income,
    spend,
    net,
  };

  return {
    payslip: {
      periodLabel: derivePeriodLabel(payslipLatest),
      totals: payslipTotals,
      earnings: cloneLineItems(payslipMetrics.earnings),
      deductions: cloneLineItems(payslipMetrics.deductions),
    },
    bankStatement: {
      periodLabel: derivePeriodLabel(latestEntry(statementEntries)),
      totals: bankTotals,
      moneyIn: income,
      moneyOut: spend,
      transactions: Array.isArray(statementSummary?.transactions)
        ? statementSummary.transactions.map((tx) => ({ ...tx }))
        : [],
    },
  };
}

function latestDocumentMonthKey(docSources = {}) {
  let latest = null;
  const consider = (value) => {
    const date = toDate(value);
    if (!date) return;
    if (!latest || date > latest) latest = date;
  };
  for (const entry of Object.values(docSources)) {
    if (!entry) continue;
    const preferred = entry.__preferred || getPreferredInsight(entry);
    const meta = entry.metadata || {};
    const metrics = entry.metrics || {};
    consider(meta.documentDate);
    if (meta.documentMonth) consider(`${meta.documentMonth}-01`);
    consider(meta.payDate);
    consider(metrics.payDate);
    if (preferred?.documentDate) consider(preferred.documentDate);
    if (preferred?.documentMonth) consider(`${preferred.documentMonth}-01`);
    if (preferred?.metricsV1?.period) {
      consider(preferred.metricsV1.period.start);
      consider(preferred.metricsV1.period.end);
    }
    if (meta.period) {
      consider(meta.period.start);
      consider(meta.period.end);
    }
    if (entry.period) {
      consider(entry.period.start);
      consider(entry.period.end);
    }
    if (metrics.period) {
      consider(metrics.period.start);
      consider(metrics.period.end);
    }
    if (Array.isArray(meta.statementPeriods)) {
      meta.statementPeriods.forEach((period) => {
        consider(period?.start);
        consider(period?.end);
      });
    }
    const files = Array.isArray(entry.files) ? entry.files : [];
    files.forEach((file) => consider(file?.uploadedAt));
    const transactions = Array.isArray(entry.transactions) ? entry.transactions : [];
    transactions.forEach((tx) => consider(tx?.date));
  }
  if (!latest) return null;
  const year = latest.getUTCFullYear();
  const month = String(latest.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function startOfQuarter(date) {
  const d = dayjs(date);
  const month = d.month();
  const qStartMonth = Math.floor(month / 3) * 3;
  return d.month(qStartMonth).startOf('month');
}

function endOfQuarter(date) {
  return startOfQuarter(date).add(3, 'month').subtract(1, 'day').endOf('day');
}

function quarterLabel(date) {
  const d = dayjs(date);
  const quarter = Math.floor(d.month() / 3) + 1;
  return `Q${quarter} ${d.format('YYYY')}`;
}

function computeDeltaValue(current, previous, mode = 'absolute') {
  if (current == null || previous == null) return null;
  const curr = Number(current);
  const prev = Number(previous);
  if (!Number.isFinite(curr) || !Number.isFinite(prev)) return null;
  if (mode === 'percent') {
    if (prev === 0) return null;
    return ((curr - prev) / Math.abs(prev)) * 100;
  }
  return curr - prev;
}

function parseRange(query, options = {}) {
  const docSources = options.docSources || {};
  const preset = String(query.preset || '').toLowerCase();
  const start = query.start ? dayjs(query.start) : null;
  const end = query.end ? dayjs(query.end) : null;

  const now = dayjs();
  if (start && end && start.isValid() && end.isValid()) {
    const rangeStart = start.startOf('day');
    const rangeEnd = end.endOf('day');
    const previous = prevComparableRange({ start: rangeStart.toDate(), end: rangeEnd.toDate() });
    const previousLabel = `${dayjs(previous.start).format('D MMM YYYY')} – ${dayjs(previous.end).format('D MMM YYYY')}`;
    return {
      mode: 'custom',
      start: rangeStart.toDate(),
      end: rangeEnd.toDate(),
      label: `${rangeStart.format('D MMM YYYY')} – ${rangeEnd.format('D MMM YYYY')}`,
      comparisonLabel: `vs ${previousLabel}`,
      previous: { start: previous.start, end: previous.end, label: previousLabel },
    };
  }

  const latestMonthKey = latestDocumentMonthKey(docSources);
  const latestMonth = latestMonthKey ? dayjs(`${latestMonthKey}-01`) : null;

  switch (preset) {
    case 'last-year':
      {
        const base = latestMonth?.isValid() ? latestMonth.subtract(1, 'year') : now.subtract(1, 'year');
        const startOfYear = base.startOf('year');
        const endOfYear = base.endOf('year');
        const prevBase = startOfYear.subtract(1, 'year');
        const prevStart = prevBase.startOf('year');
        const prevEnd = prevBase.endOf('year');
        const prevLabel = prevStart.format('YYYY');
        return {
          mode: 'preset',
          preset: 'last-year',
          start: startOfYear.toDate(),
          end: endOfYear.toDate(),
          label: `Last year · ${startOfYear.format('YYYY')}`,
          comparisonLabel: `vs ${prevLabel}`,
          previous: { start: prevStart.toDate(), end: prevEnd.toDate(), label: prevLabel },
        };
      }
    case 'last-quarter':
      {
        const base = latestMonth?.isValid() ? latestMonth.subtract(1, 'month') : now.subtract(3, 'month');
        const startQ = startOfQuarter(base);
        const endQ = endOfQuarter(base);
        const prevBase = startQ.subtract(3, 'month');
        const prevStart = startOfQuarter(prevBase);
        const prevEnd = endOfQuarter(prevBase);
        const prevLabel = quarterLabel(prevStart);
        return {
          mode: 'preset',
          preset: 'last-quarter',
          start: startQ.toDate(),
          end: endQ.toDate(),
          label: `Last quarter · ${quarterLabel(startQ)}`,
          comparisonLabel: `vs ${prevLabel}`,
          previous: { start: prevStart.toDate(), end: prevEnd.toDate(), label: prevLabel },
        };
      }
    case 'last-month':
      {
        const base = latestMonth?.isValid() ? latestMonth.subtract(1, 'month') : now.subtract(1, 'month');
        const startOfMonth = base.startOf('month');
        const endOfMonth = base.endOf('month');
        const prevBase = startOfMonth.subtract(1, 'month');
        const prevStart = prevBase.startOf('month');
        const prevEnd = prevBase.endOf('month');
        const prevLabel = prevStart.format('MMM YYYY');
        return {
          mode: 'preset',
          preset: 'last-month',
          start: startOfMonth.toDate(),
          end: endOfMonth.toDate(),
          label: `Last month · ${startOfMonth.format('MMM YYYY')}`,
          comparisonLabel: `vs ${prevLabel}`,
          previous: { start: prevStart.toDate(), end: prevEnd.toDate(), label: prevLabel },
        };
      }
    default:
      {
        const base = latestMonth?.isValid() ? latestMonth : now;
        const startOfMonth = base.startOf('month');
        const endOfMonth = base.endOf('month');
        const prevBase = startOfMonth.subtract(1, 'month');
        const prevStart = prevBase.startOf('month');
        const prevEnd = prevBase.endOf('month');
        const prevLabel = prevStart.format('MMM YYYY');
        return {
          mode: 'preset',
          preset: 'now',
          start: startOfMonth.toDate(),
          end: endOfMonth.toDate(),
          label: `Now · ${startOfMonth.format('MMM YYYY')}`,
          comparisonLabel: `vs ${prevLabel}`,
          previous: { start: prevStart.toDate(), end: prevEnd.toDate(), label: prevLabel },
        };
      }
  }
}

function daysBetween(a, b) {
  return Math.max(1, Math.round((b - a) / (1000 * 60 * 60 * 24)));
}

function prevComparableRange(range) {
  const durationMs = Math.max(1, range.end.getTime() - range.start.getTime());
  const prevEnd = new Date(range.start.getTime());
  const prevStart = new Date(prevEnd.getTime() - durationMs);
  return { start: prevStart, end: prevEnd };
}

// TODO(analytics-cache): Retire ad-hoc usage stats once DocChecklist + AnalyticsCache models land.
async function computeUsageStats(userId, range) {
  try {
    const [txAll, docsIndex, accounts] = await Promise.all([
      readJsonSafe(paths.transactions, { transactions: [] }),
      readJsonSafe(paths.docsIndex, []),
      readJsonSafe(paths.accounts, { accounts: [] })
    ]);

    const transactions = Array.isArray(txAll.transactions) ? txAll.transactions : [];
    const prev = prevComparableRange(range);

    const withinRange = transactions.filter((t) => {
      const when = new Date(t.date);
      return when >= range.start && when < range.end;
    });
    const withinPrev = transactions.filter((t) => {
      const when = new Date(t.date);
      return when >= prev.start && when < prev.end;
    });

    const sumIncome = (list) =>
      list.reduce((acc, t) => acc + (money(t.amount) > 0 ? money(t.amount) : 0), 0);
    const sumSpend = (list) =>
      list.reduce((acc, t) => acc + (money(t.amount) < 0 ? Math.abs(money(t.amount)) : 0), 0);

    const incomeCurrent = sumIncome(withinRange);
    const spendCurrent = sumSpend(withinRange);
    const incomePrev = sumIncome(withinPrev);
    const spendPrev = sumSpend(withinPrev);

    const netCurrent = incomeCurrent - spendCurrent;
    const netPrev = incomePrev - spendPrev;

    const moneySavedEstimate = Math.max(0, spendPrev - spendCurrent);
    const moneySavedChangePct =
      spendPrev > 0 ? ((spendPrev - spendCurrent) / spendPrev) * 100 : null;

    const debtAccounts = (accounts.accounts || []).filter((a) =>
      ['loan', 'credit'].includes(String(a.type))
    );
    const debtOutstanding = debtAccounts.reduce(
      (acc, a) => acc + Math.max(0, money(a.balance)),
      0
    );
    const debtReduced = Math.min(debtOutstanding, Math.max(0, netCurrent));
    const debtReductionDelta = Math.round(debtReduced - Math.max(0, netPrev));

    const docs = Array.isArray(docsIndex) ? docsIndex : [];
    const userDocs = docs.filter((doc) => String(doc.userId) === String(userId));
    const haveTypes = new Set(
      userDocs
        .map((doc) => String(doc.type || '').toLowerCase())
        .filter((type) => type.length)
    );
    const totalRequired = REQUIRED_DOC_TYPES.length;
    const completedRequired = REQUIRED_DOC_TYPES.filter((doc) =>
      haveTypes.has(doc.type)
    ).length;
    const documentsProgress = totalRequired
      ? Math.min(100, Math.round((completedRequired / totalRequired) * 100))
      : 0;

    return {
      documentsUploaded: userDocs.length,
      documentsRequiredMet: documentsProgress,
      documentsRequiredCompleted: completedRequired,
      documentsRequiredTotal: totalRequired,
      documentsOutstanding: Math.max(0, totalRequired - completedRequired),
      moneySavedEstimate: Math.round(moneySavedEstimate),
      moneySavedPrevSpend: Math.round(spendPrev),
      moneySavedChangePct:
        moneySavedChangePct == null ? null : Math.round(moneySavedChangePct),
      debtOutstanding: Math.round(debtOutstanding),
      debtReduced: Math.round(debtReduced),
      debtReductionDelta,
      netCashFlow: Math.round(netCurrent),
      netCashPrev: Math.round(netPrev),
      usageWindowDays: daysBetween(range.start, range.end),
      updatedAt: new Date()
    };
  } catch (err) {
    console.warn('Failed to compute usage stats', err);
    return null;
  }
}

function toDate(value) {
  if (!value) return null;
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return direct;
  const match = String(value).match(/(\d{4}-\d{2}-\d{2})/);
  if (match) {
    const iso = `${match[1]}T00:00:00Z`;
    const coerced = new Date(iso);
    return Number.isNaN(coerced.getTime()) ? null : coerced;
  }
  return null;
}

function withinRange(value, range) {
  const date = toDate(value);
  if (!date) return false;
  return date >= range.start && date <= range.end;
}

function monthRangeFromKey(monthKey) {
  if (!monthKey) return null;
  const parts = String(monthKey).split('-');
  if (parts.length !== 2) return null;
  const year = Number(parts[0]);
  const monthIndex = Number(parts[1]) - 1;
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex)) return null;
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999));
  return { start, end };
}

function timelineEntryWithinRange(entry, range) {
  if (!entry?.period) return false;
  let start = toDate(entry.period.start);
  let end = toDate(entry.period.end);
  if (!start || !end) {
    const monthRange = monthRangeFromKey(entry.period.month);
    if (monthRange) {
      start = start || monthRange.start;
      end = end || monthRange.end;
    }
  }
  if (!start || !end) return false;
  return start <= range.end && end >= range.start;
}

function groupSourcesByBase(sources = {}) {
  const grouped = {};
  for (const entry of Object.values(sources)) {
    if (!entry) continue;
    const baseKey = entry.baseKey || entry.key;
    if (!baseKey) continue;
    if (!grouped[baseKey]) grouped[baseKey] = [];
    grouped[baseKey].push(entry);
  }
  return grouped;
}

function summariseStatementRange(entries = [], range) {
  const accounts = new Map();
  const transactions = [];
  entries.forEach((entry) => {
    const meta = entry.metadata || {};
    const accountId = meta.accountId || entry.key;
    const accountName = meta.accountName || 'Account';
    const accountSummary = accounts.get(accountId) || {
      accountId,
      accountName,
      bankName: meta.bankName || null,
      accountType: meta.accountType || null,
      accountNumberMasked: meta.accountNumberMasked || null,
      period: meta.period || entry.period || null,
      totals: { income: 0, spend: 0 },
    };
    accounts.set(accountId, accountSummary);

    const txList = Array.isArray(entry.transactions) ? entry.transactions : [];
    const fallbackDate = meta.period?.end || meta.period?.start || entry.period || (entry.files?.[0]?.uploadedAt || null);
    txList.forEach((tx, idx) => {
      const txDate = tx.date || fallbackDate;
      if (!withinRange(txDate, range)) return;
      const amount = Number(tx.amount);
      if (!Number.isFinite(amount)) return;
      const direction = String(tx.direction || (amount >= 0 ? 'inflow' : 'outflow')).toLowerCase();
      const signedAmount = direction === 'outflow' ? -Math.abs(amount) : Math.abs(amount);
      const id = `${entry.key}:${idx}`;
      transactions.push({
        __id: id,
        amount: signedAmount,
        direction,
        description: tx.description || 'Transaction',
        category: tx.category || 'Other',
        date: tx.date || null,
        transfer: Boolean(tx.transfer),
        accountId,
        accountName,
      });
    });
  });

  if (!transactions.length) {
    return {
      totals: { income: 0, spend: 0 },
      categories: [],
      topCategories: [],
      largestExpenses: [],
      accounts: Array.from(accounts.values()).map((acc) => ({ ...acc, totals: { income: 0, spend: 0 } })),
      transactions: [],
      transferCount: 0,
      hasData: false,
    };
  }

  const signatureMap = new Map();
  const transferIds = new Set();
  transactions.forEach((tx) => {
    if (tx.transfer) transferIds.add(tx.__id);
    const dateKey = tx.date ? String(tx.date).slice(0, 10) : 'unknown';
    const descKey = String(tx.description || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const key = `${dateKey}|${Math.abs(tx.amount).toFixed(2)}|${descKey}`;
    const bucket = signatureMap.get(key) || { inflow: [], outflow: [] };
    if (tx.amount >= 0) bucket.inflow.push(tx);
    else bucket.outflow.push(tx);
    signatureMap.set(key, bucket);
  });

  for (const bucket of signatureMap.values()) {
    if (bucket.inflow.length && bucket.outflow.length) {
      bucket.inflow.forEach((tx) => transferIds.add(tx.__id));
      bucket.outflow.forEach((tx) => transferIds.add(tx.__id));
    }
  }

  const filtered = transactions.filter((tx) => !transferIds.has(tx.__id));

  filtered.forEach((tx) => {
    const acc = accounts.get(tx.accountId);
    if (!acc) return;
    if (tx.amount >= 0) acc.totals.income += tx.amount;
    else acc.totals.spend += Math.abs(tx.amount);
  });

  const totals = filtered.reduce((acc, tx) => {
    if (tx.amount >= 0) acc.income += tx.amount;
    else acc.spend += Math.abs(tx.amount);
    return acc;
  }, { income: 0, spend: 0 });

  const categoryGroups = {};
  filtered.forEach((tx) => {
    const key = tx.category || 'Other';
    if (!categoryGroups[key]) categoryGroups[key] = { category: key, inflow: 0, outflow: 0 };
    if (tx.amount >= 0) categoryGroups[key].inflow += tx.amount;
    else categoryGroups[key].outflow += Math.abs(tx.amount);
  });

  const categories = Object.values(categoryGroups)
    .sort((a, b) => (b.outflow || b.inflow) - (a.outflow || a.inflow));
  const totalOutflow = categories.reduce((acc, item) => acc + (item.outflow || 0), 0);
  const spendingCanteorgies = categories
    .filter((item) => item.outflow || item.inflow)
    .map((item) => ({
      label: item.category,
      category: item.category,
      amount: item.outflow || item.inflow || 0,
      outflow: item.outflow || 0,
      inflow: item.inflow || 0,
      share: totalOutflow ? (item.outflow || 0) / totalOutflow : 0,
    }));
  const topCategories = categories
    .filter((cat) => cat.outflow)
    .slice(0, 5)
    .map((cat) => ({
      category: cat.category,
      outflow: cat.outflow,
      inflow: cat.inflow,
    }));

  const largestExpenses = filtered
    .filter((tx) => tx.amount < 0)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, 5)
    .map((tx) => ({
      description: tx.description,
      amount: Math.abs(tx.amount),
      category: tx.category,
      date: tx.date || null,
      accountName: tx.accountName || null,
    }));

  return {
    totals,
    categories,
    topCategories,
    largestExpenses,
    accounts: Array.from(accounts.values()).map((acc) => ({
      ...acc,
      totals: {
        income: Math.round(acc.totals.income * 100) / 100,
        spend: Math.round(acc.totals.spend * 100) / 100,
      },
    })),
    transactions: filtered,
    transferCount: transferIds.size,
    hasData: filtered.length > 0,
    spendingCanteorgies,
  };
}

function buildRangeView(docSources = {}, range) {
  const grouped = groupSourcesByBase(docSources);

  const payslipEntries = Array.isArray(grouped.payslip) ? grouped.payslip : [];
  const payslipInRange = payslipEntries
    .map((entry) => ({
      entry,
      payDate: entry.metrics?.payDate
        || entry.metadata?.payDate
        || entry.metrics?.periodEnd
        || entry.metrics?.periodStart
        || entry.files?.[0]?.uploadedAt,
    }))
    .filter((item) => withinRange(item.payDate, range));
  const latestPayslip = payslipInRange
    .slice()
    .sort((a, b) => {
      const aDate = toDate(a.payDate);
      const bDate = toDate(b.payDate);
      return (bDate?.getTime() || 0) - (aDate?.getTime() || 0);
    })[0]?.entry || null;

  const statementEntries = Array.isArray(grouped.current_account_statement)
    ? grouped.current_account_statement
    : [];
  const statementSummary = summariseStatementRange(statementEntries, range);

  return {
    payslip: {
      latest: latestPayslip,
      entries: payslipInRange.map((item) => item.entry),
      hasData: payslipInRange.length > 0,
    },
    statements: statementSummary,
  };
}

router.get('/doc-insights', auth, async (req, res) => {
  const user = await User.findById(req.user.id).lean();
  if (!user) return res.status(404).json({ error: 'User not found' });

  const docInsights = user.documentInsights || {};
  const docSources = normaliseSourcesWithPreferred(docInsights.sources || {});
  const summary = buildDocInsightsSummary(docSources);

  return res.json(summary);
});

router.get('/payslips', auth, async (req, res) => {
  try {
    const userObjectId = new mongoose.Types.ObjectId(req.user.id);
    const documents = await DocumentInsight.find({ userId: userObjectId, catalogueKey: 'payslip' })
      .sort({ documentDate: -1, updatedAt: -1, createdAt: -1 })
      .lean();

    const payslips = documents.map(normalisePayslipDocument).filter(Boolean);
    res.json({ payslips });
  } catch (error) {
    console.error('GET /analytics/payslips error:', error);
    res.status(500).json({ error: 'Unable to load payslip insights' });
  }
});

// GET /api/analytics/dashboard
router.get('/dashboard', auth, async (req, res) => {
  if (!featureFlags.enableAnalyticsLegacy) {
    return res.status(404).json({ error: 'Legacy analytics disabled' });
  }
  const user = await User.findById(req.user.id).lean();
  if (!user) return res.status(404).json({ error: 'User not found' });

  const docInsights = user.documentInsights || {};
  const docSources = normaliseSourcesWithPreferred(docInsights.sources || {});
  const docAggregates = docInsights.aggregates || {};
  const docProcessing = docInsights.processing || {};
  const range = parseRange(req.query, { docSources });
  const hasData = Object.keys(docSources).length > 0;
  const timelineRaw = Array.isArray(docInsights.timeline) ? docInsights.timeline : [];
  const timelineInRange = timelineRaw.filter((entry) => timelineEntryWithinRange(entry, range));
  const wealthPlan = user.wealthPlan || {};
  const summary = wealthPlan.summary || {};
  const assetAllocation = Array.isArray(summary.assetAllocation) ? summary.assetAllocation : [];
  const liabilitySchedule = Array.isArray(summary.liabilitySchedule) ? summary.liabilitySchedule : [];
  const affordability = summary.affordability || {};
  const rangeView = buildRangeView(docSources, range);
  const latestPayslipEntry = rangeView.payslip.latest;
  const statementSummary = rangeView.statements;
  const previousRange = range.previous || null;
  const previousView = previousRange ? buildRangeView(docSources, previousRange) : null;
  const previousPayslipEntry = previousView?.payslip?.latest || null;
  const previousStatementSummary = previousView?.statements || null;
  const deltaMode = user.preferences?.deltaMode || 'absolute';

  const grossIncomeCurrent = latestPayslipEntry?.metrics?.gross != null ? Number(latestPayslipEntry.metrics.gross) : null;
  const grossIncomePrevious = previousPayslipEntry?.metrics?.gross != null ? Number(previousPayslipEntry.metrics.gross) : null;
  const totalSpendCurrent = statementSummary?.hasData ? Number(statementSummary.totals.spend || 0) : null;
  const totalSpendPrevious = previousStatementSummary?.hasData ? Number(previousStatementSummary.totals.spend || 0) : null;
  const incomeFromStatementsCurrent = statementSummary?.hasData ? Number(statementSummary.totals.income || 0) : null;
  const incomeFromStatementsPrevious = previousStatementSummary?.hasData ? Number(previousStatementSummary.totals.income || 0) : null;
  const savingsCapacityCurrent = (incomeFromStatementsCurrent != null && totalSpendCurrent != null)
    ? incomeFromStatementsCurrent - totalSpendCurrent
    : null;
  const savingsCapacityPrevious = (incomeFromStatementsPrevious != null && totalSpendPrevious != null)
    ? incomeFromStatementsPrevious - totalSpendPrevious
    : null;

  const assetBreakdown = assetAllocation.map((item) => ({
    key: item.key || item.label,
    label: item.label || item.key,
    value: Number(item.total || 0),
    weight: item.weight || 0,
    type: 'asset'
  }));

  const liabilityBreakdown = liabilitySchedule.map((item) => ({
    key: item.id || item.name,
    label: item.name || 'Liability',
    value: Number(item.startingBalance || 0),
    monthlyPayment: Number(item.monthlyPayment || 0),
    payoffMonths: item.payoffMonths || null,
    type: 'liability'
  }));

  const metrics = [];
  if (latestPayslipEntry?.metrics?.gross != null) {
    const payMetrics = latestPayslipEntry.metrics;
    metrics.push({
      key: 'income',
      value: grossIncomeCurrent,
      format: 'currency',
      subLabel: (() => {
        const net = payMetrics.net;
        const pct = payMetrics.takeHomePercent;
        if (net != null && pct != null) {
          return `Take-home ${Number(net).toLocaleString('en-GB', { style: 'currency', currency: 'GBP' })} (${(pct * 100).toFixed(1)}% of gross).`;
        }
        if (net != null) {
          return `Net pay ${Number(net).toLocaleString('en-GB', { style: 'currency', currency: 'GBP' })}.`;
        }
        return 'Derived from latest payslip in range.';
      })(),
      sourceNote: 'Derived from payslip uploads within the selected range.',
      delta: computeDeltaValue(grossIncomeCurrent, grossIncomePrevious, deltaMode),
      deltaMode,
    });
  }
  if (statementSummary?.hasData) {
    const spendValue = totalSpendCurrent ?? Number(statementSummary.totals.spend || 0);
    const savingsValue = savingsCapacityCurrent != null
      ? savingsCapacityCurrent
      : Number(statementSummary.totals.income || 0) - Number(statementSummary.totals.spend || 0);
    metrics.push({
      key: 'spend',
      value: spendValue,
      format: 'currency',
      delta: computeDeltaValue(spendValue, totalSpendPrevious, deltaMode),
      deltaMode,
      sourceNote: 'Calculated from categorised transactions in current account statements (range filtered).'
    });
    metrics.push({
      key: 'savingsCapacity',
      value: savingsValue,
      format: 'currency',
      subLabel: 'Income minus spending from documents in range',
      sourceNote: 'Income and spending inferred from bank statements (range filtered).',
      delta: computeDeltaValue(savingsValue, savingsCapacityPrevious, deltaMode),
      deltaMode,
    });
  }
  if (docAggregates.tax?.taxDue != null) {
    metrics.push({
      key: 'hmrcBalance',
      value: Number(docAggregates.tax.taxDue),
      format: 'currency',
      subLabel: 'Outstanding balance from HMRC correspondence',
      sourceNote: 'Based on latest HMRC correspondence upload.'
    });
  }

  const comparatives = {
    mode: deltaMode,
    label: range.comparisonLabel || 'Comparing to previous period',
    values: [
      { key: 'income', current: grossIncomeCurrent, previous: grossIncomePrevious },
      { key: 'spend', current: totalSpendCurrent, previous: totalSpendPrevious },
      { key: 'savingsCapacity', current: savingsCapacityCurrent, previous: savingsCapacityPrevious },
    ],
  };

  const categorySourceRaw = Array.isArray(statementSummary?.spendingCanteorgies)
    ? statementSummary.spendingCanteorgies
    : Array.isArray(statementSummary?.categories)
      ? statementSummary.categories
      : [];
  const totalSpendRaw = categorySourceRaw.reduce((acc, item) => acc + Number(item.outflow ?? item.amount ?? 0), 0);
  const spendDivisor = totalSpendRaw || Number(statementSummary?.totals?.spend || 0);
  const spendCategories = categorySourceRaw
    .filter((cat) => (cat.outflow || cat.amount))
    .map((cat) => ({
      label: cat.label || cat.category || 'Category',
      amount: Number(cat.outflow ?? cat.amount ?? 0),
      share: spendDivisor ? Number(cat.outflow ?? cat.amount ?? 0) / spendDivisor : 0,
    }));

  const processingStates = Object.entries(docProcessing).map(([k, state]) => ({ key: k, ...(state || {}) }));
  const processingActive = processingStates.some((state) => state.active);
  const processingMessage = processingStates.find((state) => state.active && state.message)?.message
    || (processingActive ? 'Updating analytics…' : null);

  const payslipAnalytics = latestPayslipEntry?.metrics
    ? {
        gross: latestPayslipEntry.metrics.gross ?? null,
        grossYtd: latestPayslipEntry.metrics.grossYtd ?? null,
        net: latestPayslipEntry.metrics.net ?? null,
        netYtd: latestPayslipEntry.metrics.netYtd ?? null,
        tax: latestPayslipEntry.metrics.tax ?? null,
        ni: latestPayslipEntry.metrics.ni ?? null,
        pension: latestPayslipEntry.metrics.pension ?? null,
        studentLoan: latestPayslipEntry.metrics.studentLoan ?? null,
        totalDeductions: latestPayslipEntry.metrics.totalDeductions ?? null,
        annualisedGross: latestPayslipEntry.metrics.annualisedGross ?? null,
        effectiveMarginalRate: latestPayslipEntry.metrics.effectiveMarginalRate ?? null,
        expectedMarginalRate: latestPayslipEntry.metrics.expectedMarginalRate ?? null,
        marginalRateDelta: latestPayslipEntry.metrics.marginalRateDelta ?? null,
        takeHomePercent: latestPayslipEntry.metrics.takeHomePercent ?? null,
        payFrequency: latestPayslipEntry.metrics.payFrequency || null,
        taxCode: latestPayslipEntry.metrics.taxCode || null,
        deductions: Array.isArray(latestPayslipEntry.metrics.deductions) ? latestPayslipEntry.metrics.deductions : [],
        earnings: Array.isArray(latestPayslipEntry.metrics.earnings) ? latestPayslipEntry.metrics.earnings : [],
        allowances: Array.isArray(latestPayslipEntry.metrics.allowances) ? latestPayslipEntry.metrics.allowances : [],
        notes: latestPayslipEntry.metrics.notes || [],
        extractionSource: latestPayslipEntry.metrics.extractionSource || null,
        payDate: latestPayslipEntry.metrics.payDate || latestPayslipEntry.metadata?.payDate || null,
        periodStart: latestPayslipEntry.metrics.periodStart || latestPayslipEntry.metadata?.periodStart || null,
        periodEnd: latestPayslipEntry.metrics.periodEnd || latestPayslipEntry.metadata?.periodEnd || null,
      }
    : null;

  const statementHighlights = statementSummary?.hasData
    ? {
        totalIncome: statementSummary.totals.income ?? null,
        totalSpend: statementSummary.totals.spend ?? null,
        topCategories: Array.isArray(statementSummary.topCategories) ? statementSummary.topCategories : [],
        largestExpenses: Array.isArray(statementSummary.largestExpenses) ? statementSummary.largestExpenses : [],
        accounts: Array.isArray(statementSummary.accounts) ? statementSummary.accounts : [],
        transferCount: statementSummary.transferCount || 0,
        spendingCanteorgies: Array.isArray(statementSummary.spendingCanteorgies)
          ? statementSummary.spendingCanteorgies
          : [],
      }
    : null;

  const rangeStatus = {
    payslip: rangeView.payslip.hasData ? null : 'No payslip data in selected range.',
    statements: statementSummary?.hasData ? null : 'No statements in selected range.',
  };

  const usage = user.usageStats || {};
  const documentsProgress = {
    required: {
      completed: usage.documentsRequiredMet || 0,
      total: usage.documentsRequiredTotal || REQUIRED_DOC_TYPES.length,
    },
    helpful: {
      completed: usage.documentsHelpfulMet || 0,
      total: usage.documentsHelpfulTotal || 0,
    },
    analytics: {
      completed: usage.documentsAnalyticsMet || 0,
      total: usage.documentsAnalyticsTotal || 0,
    },
    updatedAt: usage.documentsProgressUpdatedAt || null,
  };
  const progressPercent = documentsProgress.required.total
    ? Math.round((documentsProgress.required.completed / documentsProgress.required.total) * 100)
    : 0;

  const usageStatsNew = await computeUsageStats(user._id, range);
  if (usageStatsNew) {
    const prevUsage = user.usageStats || {};
    const prevSaved = Number(prevUsage.moneySavedEstimate || 0);
    const newSaved = Number(usageStatsNew.moneySavedEstimate || 0);
    let cumulative = Number(prevUsage.moneySavedCumulative || 0);
    if (newSaved > prevSaved) cumulative += newSaved - prevSaved;
    usageStatsNew.moneySavedCumulative = Math.round(cumulative);
    const nextUsage = { ...prevUsage, ...usageStatsNew };
    await User.findByIdAndUpdate(user._id, { $set: { usageStats: nextUsage } }).exec().catch(() => {});
    user.usageStats = nextUsage;
  }

  const payload = {
    range,
    preferences: user.preferences || {},
    hasData,
    accounting: {
      metrics,
      allowances: [],
      obligations: [],
      processing: {
        active: processingActive,
        message: processingMessage,
        states: processingStates,
      },
      documents: {
        required: [],
        helpful: [],
        analytics: [],
        progress: documentsProgress,
        progressPercent,
      },
      comparatives,
      spendByCategory: spendCategories,
      spendingCanteorgies: spendCategories,
      timeline: timelineInRange,
      largestExpenses: Array.isArray(statementSummary?.largestExpenses) ? statementSummary.largestExpenses : [],
      payslipAnalytics,
      statementHighlights,
      hmrcBalance: docAggregates.tax?.taxDue != null ? { value: Number(docAggregates.tax.taxDue) } : null,
      rangeStatus,
    },
    financialPosture: {
      netWorth: summary.netWorth ?? null,
      breakdown: [...assetBreakdown, ...liabilityBreakdown],
      liquidity: summary.cashReserves != null ? {
        cash: Number(summary.cashReserves || 0),
        runwayMonths: summary.runwayMonths ?? null
      } : null,
      trends: summary.projections?.yearly || [],
      savingsRate: affordability.savingsRateCurrent ?? null,
      affordability: {
        freeCashflow: affordability.freeCashflow ?? null,
        recommendedContribution: affordability.recommendedContribution ?? null,
        recommendedSavingsRate: affordability.recommendedSavingsRate ?? null,
        advisories: Array.isArray(affordability.advisories) ? affordability.advisories : []
      }
    },
    salaryNavigator: user.salaryNavigator || {},
    wealthPlan,
    aiInsights: [],
    gating: {
      tier: user.licenseTier || 'free'
    }
  };

  const advisories = Array.isArray(affordability.advisories) ? affordability.advisories.filter(Boolean) : [];
  if (advisories.length) {
    payload.aiInsights.push({
      id: `affordability-${Date.now()}`,
      type: 'affordability',
      title: 'Affordability advisory',
      body: advisories.join(' '),
      createdAt: new Date()
    });
  }

  res.json(payload);
});

router.post('/reprocess', auth, async (req, res) => {
  const userId = req.user.id;
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const overlayKey = 'reprocess';
  try {
    const startedAt = new Date();
    const processingState = { active: true, message: 'Reprocessing documents…', updatedAt: startedAt };
    await setInsightsProcessing(userId, overlayKey, processingState);

    const documents = await DocumentInsight.find({ userId: userObjectId }).sort({ updatedAt: 1 }).lean();

    await User.findByIdAndUpdate(userId, {
      $set: {
        documentInsights: {
          sources: {},
          aggregates: {},
          timeline: [],
          processing: { [overlayKey]: processingState },
          updatedAt: startedAt,
        },
      },
    }).exec();

    let applied = 0;
    for (const doc of documents) {
      if (!doc?.catalogueKey) continue;
      const metadata = { ...(doc.metadata || {}) };
      if (doc.documentMonth && !metadata.documentMonth) metadata.documentMonth = doc.documentMonth;
      if (doc.documentLabel && !metadata.documentLabel) metadata.documentLabel = doc.documentLabel;
      if (doc.documentName && !metadata.documentName) metadata.documentName = doc.documentName;
      if (!metadata.documentDate) {
        if (doc.documentDate instanceof Date && !Number.isNaN(doc.documentDate.valueOf())) {
          metadata.documentDate = doc.documentDate.toISOString();
        } else if (typeof doc.documentDate === 'string' && doc.documentDate) {
          metadata.documentDate = doc.documentDate;
        } else if (doc.documentDateV1) {
          metadata.documentDate = doc.documentDateV1;
        }
      }
      if (metadata.accountId && typeof metadata.accountId === 'object' && typeof metadata.accountId.toString === 'function') {
        metadata.accountId = metadata.accountId.toString();
      }

      const insights = {
        storeKey: doc.catalogueKey,
        baseKey: doc.baseKey || doc.catalogueKey,
        metrics: doc.metrics || {},
        metadata,
        transactions: Array.isArray(doc.transactions) ? doc.transactions : [],
        narrative: Array.isArray(doc.narrative) ? doc.narrative : [],
      };

      const uploadedAt = doc.updatedAt || doc.createdAt || null;
      const fileInfo = {
        id: doc.fileId,
        name: doc.documentName || metadata.documentName || doc.documentLabel || doc.fileId,
        uploadedAt: uploadedAt instanceof Date ? uploadedAt.toISOString() : uploadedAt || null,
      };

      await applyDocumentInsights(userId, doc.catalogueKey, insights, fileInfo);
      applied += 1;
    }

    const months = Array.from(new Set(documents.map((doc) => doc.documentMonth).filter(Boolean)));
    for (const month of months) {
      await rebuildMonthlyAnalytics({ userId: userObjectId, month });
    }

    await setInsightsProcessing(userId, overlayKey, {
      active: false,
      message: applied ? 'Document analytics refreshed' : 'No documents to refresh',
    });

    res.json({ refreshed: applied, months });
  } catch (error) {
    await setInsightsProcessing(userId, overlayKey, {
      active: false,
      message: 'Document refresh failed',
    });
    console.error('POST /analytics/reprocess error:', error);
    res.status(500).json({ error: 'Failed to refresh analytics' });
  }
});

router.__test = { normaliseSourcesWithPreferred, buildDocInsightsSummary };

module.exports = router;

function normalisePayslipDocument(doc) {
  if (!doc) return null;
  const preferred = getPreferredInsight(doc) || {};
  const metadata = preferred.metadata || doc.metadata || {};
  const mergedMetrics = mergePayslipMetrics(preferred.legacyMetrics || doc.metrics || {}, preferred.metricsV1 || null);

  const idSource = doc.fileId || (typeof doc._id?.toString === 'function' ? doc._id.toString() : doc._id);
  const id = typeof idSource === 'string' ? idSource : String(idSource || '');
  if (!id) return null;

  const payDate = toDateOnly(
    mergedMetrics.payDate
      || preferred.metricsV1?.payDate
      || metadata.payDate
      || doc.documentDate
      || metadata.documentDate
  );

  const periodStart = toDateOnly(
    mergedMetrics.period?.start
      || mergedMetrics.periodStart
      || preferred.metricsV1?.period?.start
      || metadata.period?.start
  );

  const periodEnd = toDateOnly(
    mergedMetrics.period?.end
      || mergedMetrics.periodEnd
      || preferred.metricsV1?.period?.end
      || metadata.period?.end
  );

  const month = pickFirst(
    mergedMetrics.period?.month,
    mergedMetrics.periodMonth,
    preferred.metricsV1?.period?.month,
    metadata.period?.month,
    doc.documentMonth,
    payDate ? payDate.slice(0, 7) : null,
  );

  const periodLabel = pickFirst(
    mergedMetrics.period?.label,
    metadata.period?.label,
    formatMonthLabel(month),
  );

  const payFrequency = pickFirst(
    mergedMetrics.payFrequency,
    metadata.period?.payFrequency,
    metadata.payFrequency,
  );

  const earnings = normaliseLineItems(mergedMetrics.earnings || metadata.earnings || []);
  const deductions = normaliseLineItems(mergedMetrics.deductions || metadata.deductions || [], { absolute: true });

  const gross = firstNumber(
    mergedMetrics.gross,
    mergedMetrics.grossPeriod,
    mergedMetrics.totals?.gross,
    mergedMetrics.totals?.grossPeriod,
    toMajor(preferred.metricsV1?.grossMinor),
  );

  const net = firstNumber(
    mergedMetrics.net,
    mergedMetrics.netPeriod,
    mergedMetrics.totals?.net,
    mergedMetrics.totals?.netPeriod,
    toMajor(preferred.metricsV1?.netMinor),
  );

  const deductionsFromMinor = sumDefined([
    toMajor(preferred.metricsV1?.taxMinor),
    toMajor(preferred.metricsV1?.nationalInsuranceMinor),
    toMajor(preferred.metricsV1?.pensionMinor),
    toMajor(preferred.metricsV1?.studentLoanMinor),
  ]);

  const deductionsTotal = firstNumber(
    mergedMetrics.totalDeductions,
    mergedMetrics.deductionsTotal,
    mergedMetrics.totals?.deductions,
    mergedMetrics.totals?.totalDeductions,
    deductionsFromMinor,
    deductions.reduce((acc, item) => acc + (item.amount || 0), 0),
  );

  const currency = pickFirst(
    doc.currency,
    mergedMetrics.currency,
    metadata.currency,
    preferred.currency,
    'GBP',
  );

  const uploadedAt = toIsoDate(
    metadata.uploadedAt
      || doc.updatedAt
      || doc.createdAt
      || preferred.metricsV1?.payDate
  );

  const employer = pickFirst(
    mergedMetrics.employerName,
    mergedMetrics.employer?.name,
    metadata.employerName,
    metadata.employer?.name,
    preferred.metricsV1?.employer?.name,
  );

  const period = {
    start: periodStart || null,
    end: periodEnd || null,
    month: month || null,
    frequency: payFrequency || null,
  };
  if (periodLabel) period.label = periodLabel;

  const totals = {
    gross: gross ?? null,
    net: net ?? null,
    deductions: deductionsTotal ?? null,
  };

  const entry = {
    id,
    fileId: doc.fileId || null,
    catalogueKey: doc.catalogueKey,
    employer: employer || null,
    payDate: payDate || null,
    currency,
    earnings,
    deductions,
    uploadedAt,
    insightId: typeof doc._id?.toString === 'function' ? doc._id.toString() : doc._id || null,
    documentMonth: doc.documentMonth || month || null,
  };

  entry.period = period;
  entry.totals = totals;

  return entry;
}

function normaliseLineItems(list, { absolute = false } = {}) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      if (!item) return null;
      const label = pickFirst(item.label, item.name, item.rawLabel, item.category);
      const amountRaw = firstNumber(
        item.amount,
        item.total,
        item.value,
        item.amountPeriod,
        item.amountCurrent,
        item.amountMinor != null ? toMajor(item.amountMinor) : null,
      );
      if (label == null || amountRaw == null) return null;

      const amountYtdRaw = firstNumber(
        item.amountYtd,
        item.amountYearToDate,
        item.amountYTD,
        item.yearToDate,
        item.totalYtd,
        item.amountYtdMinor != null ? toMajor(item.amountYtdMinor) : null,
        item.ytd,
      );

      const amount = absolute ? Math.abs(amountRaw) : amountRaw;
      const amountYtd =
        amountYtdRaw == null ? null : absolute ? Math.abs(amountYtdRaw) : amountYtdRaw;
      const category = pickFirst(item.category, item.type, item.rawLabel, label);

      return { label, amount, amountYtd, category };
    })
    .filter(Boolean);
}

function pickFirst(...candidates) {
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed) return trimmed;
      continue;
    }
    if (candidate instanceof Date) {
      if (!Number.isNaN(candidate.getTime())) return candidate;
      continue;
    }
    if (typeof candidate === 'object') {
      if (Array.isArray(candidate)) {
        if (candidate.length) return candidate;
        continue;
      }
      if (Object.keys(candidate).length) return candidate;
      continue;
    }
    if (candidate !== '') return candidate;
  }
  return null;
}

function firstNumber(...candidates) {
  for (const candidate of candidates) {
    if (candidate == null || candidate === '') continue;
    const num = Number(candidate);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function sumDefined(values = []) {
  const numbers = values.filter((value) => Number.isFinite(value));
  if (!numbers.length) return null;
  return numbers.reduce((acc, value) => acc + value, 0);
}

function toIsoDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function toDateOnly(value) {
  const iso = toIsoDate(value);
  return iso ? iso.slice(0, 10) : null;
}

function formatMonthLabel(month) {
  if (!month || typeof month !== 'string') return null;
  const trimmed = month.trim();
  if (!/^[0-9]{4}-[0-9]{2}$/.test(trimmed)) return null;
  const candidate = dayjs(`${trimmed}-01`);
  if (!candidate.isValid()) return null;
  return candidate.format('MMM YYYY');
}
