const dayjs = require('dayjs');
const User = require('../../../models/User');
const DocumentInsight = require('../../../models/DocumentInsight');
const { sha256 } = require('../../lib/hash');
const { normaliseDocumentInsight } = require('./insightNormaliser');

const LEGACY_SCHEMA_VERSION = 'legacy-v1';
const LEGACY_PARSER_VERSION = 'legacy-parser-v1';
const LEGACY_PROMPT_VERSION = 'legacy-prompt-v1';
const LEGACY_MODEL = 'legacy-ingest';

function mergeFileReference(existing = [], fileInfo) {
  const filtered = existing.filter((item) => item.id !== fileInfo.id);
  filtered.unshift({
    id: fileInfo.id,
    name: fileInfo.name,
    uploadedAt: fileInfo.uploadedAt,
  });
  return filtered.slice(0, 5);
}

function normaliseDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const iso = value.toISOString();
    return iso;
  }
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date.toISOString();
  const match = String(value).match(/(\d{4}-\d{2}-\d{2})/);
  if (match) return `${match[1]}T00:00:00.000Z`;
  return null;
}

function indexByBaseKey(sources = {}) {
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

function isoFromValue(value) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date.toISOString();
  const str = String(value);
  const match = str.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`;
  const alt = str.match(/(\d{2})[\/\-.](\d{2})[\/\-.](\d{2,4})/);
  if (alt) {
    const day = alt[1].padStart(2, '0');
    const month = alt[2].padStart(2, '0');
    const year = alt[3].length === 2 ? `20${alt[3]}` : alt[3].padStart(4, '0');
    return `${year}-${month}-${day}T00:00:00.000Z`;
  }
  return null;
}

function monthKeyFromIsoSafe(iso) {
  if (!iso) return null;
  const match = String(iso).match(/(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : null;
}

function deriveDocumentContext(insights = {}, fileInfo = {}) {
  const metadata = insights.metadata || {};
  const metrics = insights.metrics || {};
  const candidates = [
    metadata.documentDate,
    metrics.payDate,
    metadata.payDate,
    metadata.period?.end,
    metadata.period?.start,
    metrics.periodEnd,
    metrics.periodStart,
  ];
  const txList = Array.isArray(insights.transactions) ? insights.transactions : [];
  txList.forEach((tx) => {
    if (tx?.date) candidates.push(tx.date);
  });
  if (Array.isArray(metadata.statementPeriods)) {
    metadata.statementPeriods.forEach((period) => {
      if (period?.end) candidates.push(period.end);
      if (period?.start) candidates.push(period.start);
    });
  }
  if (fileInfo?.uploadedAt) candidates.push(fileInfo.uploadedAt);

  let documentIso = null;
  for (const value of candidates) {
    const iso = isoFromValue(value);
    if (iso) {
      documentIso = iso;
      break;
    }
  }

  const monthKey = monthKeyFromIsoSafe(documentIso);
  const label = monthKey ? dayjs(documentIso).format('MMM YYYY') : null;
  const documentName = metadata.documentName || metadata.personName || metadata.accountHolder || fileInfo?.name || null;
  const nameMatchesUser = metadata.nameMatchesUser ?? null;

  return {
    documentIso,
    monthKey,
    label,
    documentName,
    nameMatchesUser,
  };
}

function summariseStatementEntries(entries = []) {
  const transactions = [];
  const accounts = new Map();
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
      extractionSource: meta.extractionSource || entry.metrics?.extractionSource || null,
    };
    accounts.set(accountId, accountSummary);

    const txList = Array.isArray(entry.transactions) ? entry.transactions : [];
    txList.forEach((tx, idx) => {
      const amount = Number(tx.amount);
      if (!Number.isFinite(amount)) return;
      const direction = String(tx.direction || (amount >= 0 ? 'inflow' : 'outflow')).toLowerCase();
      const signedAmount = direction === 'outflow' ? -Math.abs(amount) : Math.abs(amount);
      const id = `${entry.key}:${idx}`;
      transactions.push({
        ...tx,
        __id: id,
        amount: signedAmount,
        direction,
        accountId: tx.accountId || accountId,
        accountName: tx.accountName || accountName,
        bankName: tx.bankName || meta.bankName || null,
        accountType: tx.accountType || meta.accountType || null,
        statementPeriod: tx.statementPeriod || meta.period || entry.period || null,
        statementKey: entry.key,
        date: tx.date || meta.period?.end || meta.period?.start || null,
      });
    });
  });

  const signatureMap = new Map();
  const transferIds = new Set();
  transactions.forEach((tx) => {
    if (tx.transfer) transferIds.add(tx.__id);
    const dateKey = tx.date ? String(tx.date).slice(0, 10) : 'unknown';
    const descriptionKey = String(tx.description || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const key = `${dateKey}|${Math.abs(tx.amount).toFixed(2)}|${descriptionKey}`;
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
    const summary = accounts.get(tx.accountId);
    if (!summary) return;
    if (tx.amount >= 0) summary.totals.income += tx.amount;
    else summary.totals.spend += Math.abs(tx.amount);
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
    spendingCanteorgies,
    accounts: Array.from(accounts.values()).map((acc) => ({
      ...acc,
      totals: {
        income: Math.round(acc.totals.income * 100) / 100,
        spend: Math.round(acc.totals.spend * 100) / 100,
      },
    })),
    transactions: filtered,
    transferCount: transferIds.size,
  };
}

function buildAggregates(sources) {
  const aggregates = {
    income: {},
    cashflow: {},
    savings: {},
    pension: {},
    tax: {},
  };

  const grouped = indexByBaseKey(sources);

  const payslipEntries = Array.isArray(grouped.payslip) ? grouped.payslip : [];
  let latestPayslip = null;
  if (payslipEntries.length) {
    latestPayslip = payslipEntries.slice().sort((a, b) => {
      const aDate = normaliseDate(a.metadata?.payDate || a.metrics?.payDate || a.files?.[0]?.uploadedAt);
      const bDate = normaliseDate(b.metadata?.payDate || b.metrics?.payDate || b.files?.[0]?.uploadedAt);
      return (bDate || '').localeCompare(aDate || '');
    })[0];
  }

  if (latestPayslip?.metrics) {
    aggregates.income = {
      gross: latestPayslip.metrics.gross ?? null,
      grossYtd: latestPayslip.metrics.grossYtd ?? null,
      net: latestPayslip.metrics.net ?? null,
      netYtd: latestPayslip.metrics.netYtd ?? null,
      tax: latestPayslip.metrics.tax ?? null,
      ni: latestPayslip.metrics.ni ?? null,
      pension: latestPayslip.metrics.pension ?? null,
      studentLoan: latestPayslip.metrics.studentLoan ?? null,
      totalDeductions: latestPayslip.metrics.totalDeductions ?? null,
      annualisedGross: latestPayslip.metrics.annualisedGross ?? null,
      effectiveMarginalRate: latestPayslip.metrics.effectiveMarginalRate ?? null,
      expectedMarginalRate: latestPayslip.metrics.expectedMarginalRate ?? null,
      marginalRateDelta: latestPayslip.metrics.marginalRateDelta ?? null,
      takeHomePercent: latestPayslip.metrics.takeHomePercent ?? null,
      payFrequency: latestPayslip.metrics.payFrequency || null,
      taxCode: latestPayslip.metrics.taxCode || null,
      deductions: Array.isArray(latestPayslip.metrics.deductions) ? latestPayslip.metrics.deductions : [],
      earnings: Array.isArray(latestPayslip.metrics.earnings) ? latestPayslip.metrics.earnings : [],
      allowances: Array.isArray(latestPayslip.metrics.allowances) ? latestPayslip.metrics.allowances : [],
      extractionSource: latestPayslip.metrics.extractionSource || null,
      payDate: latestPayslip.metrics.payDate || latestPayslip.metadata?.payDate || null,
      periodStart: latestPayslip.metrics.periodStart || latestPayslip.metadata?.periodStart || null,
      periodEnd: latestPayslip.metrics.periodEnd || latestPayslip.metadata?.periodEnd || null,
    };
    if (latestPayslip.metrics.notes) {
      aggregates.income.notes = latestPayslip.metrics.notes;
    }
  }

  const statementEntries = Array.isArray(grouped.current_account_statement)
    ? grouped.current_account_statement
    : [];
  if (statementEntries.length) {
    const summary = summariseStatementEntries(statementEntries);
    aggregates.cashflow = {
      income: summary.totals.income,
      spend: summary.totals.spend,
      categories: summary.categories,
      topCategories: summary.topCategories,
      largestExpenses: summary.largestExpenses,
      accounts: summary.accounts,
      transferCount: summary.transferCount,
      spendingCanteorgies: summary.spendingCanteorgies,
    };
  }

  const savingsSources = [
    ...(Array.isArray(grouped.savings_account_statement) ? grouped.savings_account_statement : []),
    ...(Array.isArray(grouped.isa_statement) ? grouped.isa_statement : []),
  ];
  const savingsBalance = [];
  savingsSources.forEach((entry) => {
    if (entry?.metrics?.balance != null) savingsBalance.push(entry.metrics.balance);
  });
  if (savingsBalance.length) {
    aggregates.savings = {
      balance: savingsBalance.reduce((acc, v) => acc + (Number(v) || 0), 0),
      interest: savingsSources.find((entry) => entry?.metrics?.interest != null)?.metrics?.interest ?? null,
    };
  }

  const pensionEntries = Array.isArray(grouped.pension_statement) ? grouped.pension_statement : [];
  const latestPension = pensionEntries.slice().sort((a, b) => {
    const aDate = normaliseDate(a.files?.[0]?.uploadedAt);
    const bDate = normaliseDate(b.files?.[0]?.uploadedAt);
    return (bDate || '').localeCompare(aDate || '');
  })[0];
  if (latestPension?.metrics) {
    aggregates.pension = {
      balance: latestPension.metrics.balance ?? null,
      contributions: latestPension.metrics.contributions ?? null,
    };
  }

  const hmrcEntries = Array.isArray(grouped.hmrc_correspondence) ? grouped.hmrc_correspondence : [];
  const latestHmrc = hmrcEntries.slice().sort((a, b) => {
    const aDate = normaliseDate(a.files?.[0]?.uploadedAt);
    const bDate = normaliseDate(b.files?.[0]?.uploadedAt);
    return (bDate || '').localeCompare(aDate || '');
  })[0];
  const hmrcMetrics = latestHmrc?.metrics || {};
  if (hmrcMetrics.taxDue != null) {
    aggregates.tax = {
      taxDue: hmrcMetrics.taxDue,
    };
  }
  if ((aggregates.tax?.taxDue == null) && aggregates.income?.tax != null) {
    aggregates.tax = {
      ...aggregates.tax,
      taxDue: aggregates.income.tax,
    };
  }
  if (aggregates.income?.effectiveMarginalRate != null) {
    aggregates.tax = {
      ...aggregates.tax,
      effectiveMarginalRate: aggregates.income.effectiveMarginalRate,
      expectedMarginalRate: aggregates.income.expectedMarginalRate ?? null,
    };
  }

  return aggregates;
}

function monthKeyFromIso(iso) {
  if (!iso) return null;
  const match = String(iso).match(/(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : null;
}

function monthRangeForKey(key) {
  const [yearStr, monthStr] = key.split('-');
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex)) return { start: null, end: null, label: key };
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999));
  const label = start.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  return { start: start.toISOString(), end: end.toISOString(), label };
}

function ensureTimelineBucket(map, key) {
  if (!map.has(key)) {
    map.set(key, {
      payslip: null,
      statements: {
        income: 0,
        spend: 0,
        net: 0,
        transactions: 0,
        categoryMap: new Map(),
      },
      sources: { payslip: false, statements: false },
      statementPeriods: new Set(),
    });
  }
  return map.get(key);
}

function buildTimeline(sources = {}) {
  const buckets = new Map();
  for (const entry of Object.values(sources)) {
    if (!entry) continue;
    const baseKey = entry.baseKey || entry.key;
    if (!baseKey) continue;
    if (baseKey === 'payslip') {
      const payDateIso = normaliseDate(entry.metrics?.payDate || entry.metadata?.payDate || entry.metrics?.periodEnd || entry.metrics?.periodStart || entry.files?.[0]?.uploadedAt);
      const monthKey = monthKeyFromIso(payDateIso);
      if (!monthKey) continue;
      const bucket = ensureTimelineBucket(buckets, monthKey);
      bucket.sources.payslip = true;
      const metrics = entry.metrics || {};
      if (!bucket.payslip || (bucket.payslip.payDate || '').localeCompare(payDateIso || '') < 0) {
        bucket.payslip = {
          gross: metrics.gross ?? null,
          net: metrics.net ?? null,
          tax: metrics.tax ?? null,
          ni: metrics.ni ?? null,
          pension: metrics.pension ?? null,
          studentLoan: metrics.studentLoan ?? null,
          totalDeductions: metrics.totalDeductions ?? null,
          annualisedGross: metrics.annualisedGross ?? null,
          takeHomePercent: metrics.takeHomePercent ?? null,
          payFrequency: metrics.payFrequency || null,
          taxCode: metrics.taxCode || null,
          extractionSource: metrics.extractionSource || entry.metadata?.extractionSource || null,
          payDate: payDateIso,
          periodStart: normaliseDate(metrics.periodStart || entry.metadata?.periodStart) || null,
          periodEnd: normaliseDate(metrics.periodEnd || entry.metadata?.periodEnd) || null,
        };
      }
    } else if (baseKey === 'current_account_statement') {
      const meta = entry.metadata || {};
      const txList = Array.isArray(entry.transactions) ? entry.transactions : [];
      const fallbackStart = normaliseDate(meta.period?.start || entry.period || entry.files?.[0]?.uploadedAt);
      const fallbackEnd = normaliseDate(meta.period?.end || entry.period || entry.files?.[0]?.uploadedAt);
      txList.forEach((tx) => {
        const amount = Number(tx.amount);
        if (!Number.isFinite(amount)) return;
        const direction = String(tx.direction || (amount >= 0 ? 'inflow' : 'outflow')).toLowerCase();
        const signedAmount = direction === 'outflow' ? -Math.abs(amount) : Math.abs(amount);
        const iso = normaliseDate(tx.date) || fallbackEnd || fallbackStart;
        const monthKey = monthKeyFromIso(iso);
        if (!monthKey) return;
        const bucket = ensureTimelineBucket(buckets, monthKey);
        bucket.sources.statements = true;
        if (signedAmount >= 0) bucket.statements.income += signedAmount;
        else bucket.statements.spend += Math.abs(signedAmount);
        bucket.statements.transactions += 1;
        const category = tx.category || 'Other';
        const record = bucket.statements.categoryMap.get(category) || { label: category, inflow: 0, outflow: 0, amount: 0 };
        if (signedAmount >= 0) {
          record.inflow += signedAmount;
          record.amount += signedAmount;
        } else {
          const abs = Math.abs(signedAmount);
          record.outflow += abs;
          record.amount += abs;
        }
        bucket.statements.categoryMap.set(category, record);
      });
      if (fallbackStart || fallbackEnd) {
        const iso = fallbackEnd || fallbackStart;
        const monthKey = monthKeyFromIso(iso);
        if (monthKey) {
          const bucket = ensureTimelineBucket(buckets, monthKey);
          bucket.statementPeriods.add(JSON.stringify({
            start: fallbackStart,
            end: fallbackEnd,
            accountId: meta.accountId || null,
          }));
          bucket.sources.statements = true;
        }
      }
    }
  }

  const results = Array.from(buckets.entries()).map(([monthKey, bucket]) => {
    const { start, end, label } = monthRangeForKey(monthKey);
    const categories = Array.from(bucket.statements.categoryMap.values())
      .sort((a, b) => (b.outflow || b.amount) - (a.outflow || a.amount));
    const totalOutflow = categories.reduce((acc, item) => acc + (item.outflow || 0), 0);
    const spendingCanteorgies = categories
      .filter((item) => item.outflow || item.amount)
      .map((item) => ({
        label: item.label,
        category: item.label,
        amount: item.outflow || item.amount || 0,
        outflow: item.outflow || 0,
        inflow: item.inflow || 0,
        share: totalOutflow ? (item.outflow || item.amount || 0) / totalOutflow : 0,
      }));
    const income = Math.round(bucket.statements.income * 100) / 100;
    const spend = Math.round(bucket.statements.spend * 100) / 100;
    return {
      period: {
        month: monthKey,
        label,
        start,
        end,
      },
      payslip: bucket.payslip,
      statements: {
        income,
        spend,
        net: Math.round((income - spend) * 100) / 100,
        transactions: bucket.statements.transactions,
        spendingCanteorgies,
      },
      sources: {
        payslip: bucket.sources.payslip,
        statements: bucket.sources.statements,
      },
    };
  });

  return results.sort((a, b) => a.period.month.localeCompare(b.period.month));
}

async function applyDocumentInsights(userId, key, insights, fileInfo) {
  if (!userId || !key || !insights) return null;
  const doc = await User.findById(userId, 'documentInsights').lean();
  const current = doc?.documentInsights || {};
  const sources = { ...(current.sources || {}) };
  const storeKey = insights.storeKey || key;
  const baseKey = insights.baseKey || key;
  const existing = sources[storeKey] || {};
  const normalised = normaliseDocumentInsight({
    ...insights,
    baseKey,
    catalogueKey: insights.catalogueKey || baseKey,
  });
  const mergedMetadata = { ...(insights.metadata || {}), ...(normalised.metadata || {}) };
  const metricsV1 = normalised.metricsV1 || existing.metricsV1 || insights.metricsV1 || null;
  const mergedInsights = {
    ...insights,
    metrics: normalised.metrics,
    metricsV1,
    metadata: mergedMetadata,
  };
  const documentContext = deriveDocumentContext(mergedInsights, fileInfo);
  sources[storeKey] = {
    ...existing,
    key: storeKey,
    baseKey,
    metrics: normalised.metrics || existing.metrics || {},
    metricsV1,
    narrative: insights.narrative || existing.narrative || [],
    transactions: insights.transactions || existing.transactions || [],
    metadata: {
      ...(existing.metadata || {}),
      ...mergedMetadata,
      documentMonth: documentContext.monthKey || existing.metadata?.documentMonth || null,
      documentLabel: documentContext.label || existing.metadata?.documentLabel || null,
      documentDate: documentContext.documentIso || existing.metadata?.documentDate || null,
      documentName: documentContext.documentName || existing.metadata?.documentName || null,
      nameMatchesUser: documentContext.nameMatchesUser ?? existing.metadata?.nameMatchesUser ?? null,
    },
    period: insights.metadata?.period || insights.metrics?.period || existing.period || null,
    files: fileInfo ? mergeFileReference(existing.files, fileInfo) : (existing.files || []),
  };

  const processing = { ...(current.processing || {}) };
  processing[baseKey] = {
    ...(processing[baseKey] || {}),
    active: false,
    message: fileInfo?.name ? `Updated from ${fileInfo.name}` : 'Analytics refreshed',
    updatedAt: new Date(),
  };

  const newState = {
    sources,
    aggregates: buildAggregates(sources),
    timeline: buildTimeline(sources),
    processing,
    updatedAt: new Date(),
  };

  await User.findByIdAndUpdate(userId, {
    $set: {
      documentInsights: newState,
    },
  }).exec().catch((err) => {
    console.warn('[documents:insightsStore] failed to persist insights', err);
  });

  if (fileInfo?.id) {
    try {
      const now = new Date();
      const extractionSource =
        mergedInsights.metadata?.extractionSource || mergedInsights.metrics?.extractionSource || 'heuristic';
      const currency = mergedInsights.metadata?.currency || 'GBP';
      const documentIso = documentContext.documentIso || null;
      const documentDate = documentIso ? new Date(documentIso) : null;
      const documentDateV1 = documentIso ? documentIso.slice(0, 10) : null;
      const insightType = mergedInsights.insightType || mergedInsights.baseKey || baseKey;
      const contentHash = sha256(
        [
          fileInfo.id,
          documentIso || '',
          JSON.stringify(normalised.metrics || {}),
          JSON.stringify(mergedInsights.transactions || []),
        ].join('|')
      );

      await DocumentInsight.findOneAndUpdate(
        { userId, fileId: fileInfo.id, insightType },
        {
          $set: {
            catalogueKey: key,
            baseKey,
            insightType,
            documentMonth: documentContext.monthKey || null,
            documentDate,
            documentLabel: documentContext.label || null,
            documentName: documentContext.documentName || null,
            nameMatchesUser: documentContext.nameMatchesUser,
            metrics: normalised.metrics || {},
            metricsV1,
            metadata: {
              ...mergedMetadata,
              documentMonth: documentContext.monthKey || null,
              documentLabel: documentContext.label || null,
              documentDate: documentIso || null,
            },
            transactions: Array.isArray(mergedInsights.transactions) ? mergedInsights.transactions : [],
            narrative: Array.isArray(mergedInsights.narrative) ? mergedInsights.narrative : [],
            extractedAt: now,
            updatedAt: now,
            schemaVersion: LEGACY_SCHEMA_VERSION,
            parserVersion: LEGACY_PARSER_VERSION,
            promptVersion: LEGACY_PROMPT_VERSION,
            model: extractionSource === 'openai' ? 'openai-legacy' : LEGACY_MODEL,
            extractionSource,
            contentHash,
            version: 'legacy-sync',
            currency,
            documentDateV1,
          },
          $setOnInsert: {
            createdAt: now,
          },
        },
        { upsert: true, setDefaultsOnInsert: true }
      ).exec();
    } catch (err) {
      console.warn('[documents:insightsStore] failed to upsert document insight', err);
    }
  }

  return newState;
}

async function setInsightsProcessing(userId, key, state) {
  if (!userId || !key) return null;
  const path = `documentInsights.processing.${key}`;
  try {
    if (!state) {
      await User.findByIdAndUpdate(userId, { $unset: { [path]: '' } }).exec();
      return null;
    }
    const payload = {
      active: Boolean(state.active),
      message: state.message || null,
      updatedAt: new Date(),
    };
    if (state.step) payload.step = state.step;
    if (state.progress != null) payload.progress = state.progress;
    if (state.fileId) payload.fileId = state.fileId;
    if (state.fileName) payload.fileName = state.fileName;
    await User.findByIdAndUpdate(userId, { $set: { [path]: payload } }).exec();
    return payload;
  } catch (err) {
    console.warn('[documents:insightsStore] failed to set processing state', err);
    return null;
  }
}

module.exports = {
  applyDocumentInsights,
  setInsightsProcessing,
};
