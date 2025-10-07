const pdfParse = require('pdf-parse');
const dayjs = require('dayjs');
const { analysePayslip } = require('./parsers/payslip');
const { analyseCurrentAccountStatement } = require('./parsers/statement');

function normalise(text) {
  return String(text || '').toLowerCase();
}

async function extractText(buffer) {
  if (!buffer || !buffer.length) return '';
  try {
    const parsed = await pdfParse(buffer);
    if (parsed && typeof parsed.text === 'string') {
      return parsed.text;
    }
  } catch (err) {
    console.warn('[documents:ingest] pdf-parse failed, falling back to filename heuristics', err?.message || err);
  }
  return '';
}

function containsKeywords(text, keywords) {
  const lower = normalise(text);
  return keywords.some((k) => lower.includes(k));
}

function extractNumber(text, labels) {
  const lower = normalise(text);
  for (const label of labels) {
    const idx = lower.indexOf(label);
    if (idx === -1) continue;
    const snippet = text.slice(Math.max(0, idx - 12), idx + 80);
    const match = snippet.match(/£\s*(-?[\d,.]+)/i)
      || snippet.match(/(-?\d[\d,.]*)(?:\s*(?:£|gbp))?/i);
    if (match) {
      const cleaned = match[1].replace(/[,£\s]/g, '');
      const value = Number.parseFloat(cleaned);
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
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
  if (user.fullName) add(user.fullName);
  if (user.preferredName) add(user.preferredName);
  if (user.firstName) add(user.firstName);
  if (user.lastName) add(user.lastName);
  if (user.firstName && user.lastName) add(`${user.firstName} ${user.lastName}`);
  if (user.username) add(user.username);
  if (Array.isArray(user.aliases)) {
    user.aliases.forEach(add);
  }
  return names;
}

function nameMatchesUser(candidate, userSet) {
  const norm = normaliseName(candidate);
  if (!norm || !userSet.size) return null;
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

async function buildInsights(entry, text, context = {}) {
  const key = entry.key;
  const insights = { key, metrics: {}, narrative: [] };
  const originalName = context.originalName || null;
  const userNames = buildUserNameSet(context.user || {});

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

  if (key === 'payslip') {
    const breakdown = await analysePayslip(text || '');
    const periodKey = breakdown.payDate || breakdown.periodEnd || breakdown.periodStart || null;
    if (periodKey) {
      insights.storeKey = `payslip:${periodKey}`;
    }
    insights.baseKey = key;
    insights.metadata = {
      payDate: breakdown.payDate || null,
      periodStart: breakdown.periodStart || null,
      periodEnd: breakdown.periodEnd || null,
      extractionSource: breakdown.extractionSource || null,
      personName: breakdown.employeeName || null,
      employerName: breakdown.employerName || null,
    };
    insights.metrics = {
      gross: breakdown.gross ?? null,
      grossYtd: breakdown.grossYtd ?? null,
      net: breakdown.net ?? null,
      netYtd: breakdown.netYtd ?? null,
      tax: breakdown.tax ?? null,
      ni: breakdown.ni ?? null,
      pension: breakdown.pension ?? null,
      studentLoan: breakdown.studentLoan ?? null,
      totalDeductions: breakdown.totalDeductions ?? null,
      annualisedGross: breakdown.annualisedGross ?? null,
      effectiveMarginalRate: breakdown.effectiveMarginalRate ?? null,
      expectedMarginalRate: breakdown.expectedMarginalRate ?? null,
      marginalRateDelta: breakdown.marginalRateDelta ?? null,
      takeHomePercent: breakdown.takeHomePercent ?? null,
      payFrequency: breakdown.payFrequency || null,
      taxCode: breakdown.taxCode || null,
      deductions: breakdown.deductions || [],
      earnings: breakdown.earnings || [],
      allowances: breakdown.allowances || [],
      notes: breakdown.notes || [],
      extractionSource: breakdown.extractionSource || 'heuristic',
      llmNotes: breakdown.llmNotes || [],
      payDate: breakdown.payDate || null,
      periodStart: breakdown.periodStart || null,
      periodEnd: breakdown.periodEnd || null,
    };
    const documentIso = stampDocumentDate(insights, breakdown.payDate || breakdown.periodEnd || breakdown.periodStart || null);
    if (breakdown.employeeName) {
      const matches = nameMatchesUser(breakdown.employeeName, userNames);
      insights.metadata.documentName = breakdown.employeeName;
      insights.metadata.nameMatchesUser = matches;
    }
    if (!insights.metadata.documentDate && documentIso) {
      insights.metadata.documentDate = documentIso;
    }
    if (insights.metrics.notes.length) {
      insights.narrative.push(...insights.metrics.notes);
    } else {
      insights.narrative.push('Earnings and deductions extracted from payslip.');
    }
  } else if (key === 'current_account_statement') {
    const analysed = await analyseCurrentAccountStatement(text || '');
    const metadata = analysed.metadata || {};
    const periodKey = [metadata.accountId, metadata.period?.start, metadata.period?.end]
      .filter(Boolean)
      .join(':');
    if (periodKey) {
      insights.storeKey = `${key}:${periodKey}`;
    } else if (metadata.accountId) {
      insights.storeKey = `${key}:${metadata.accountId}`;
    }
    insights.baseKey = key;
    insights.metadata = {
      ...metadata,
      extractionSource: analysed.extractionSource || null,
      originalName,
    };
    const transactions = (analysed.transactions || []).map((tx) => ({
      ...tx,
      amount: Number(tx.amount),
      direction: tx.direction || (Number(tx.amount) >= 0 ? 'inflow' : 'outflow'),
      accountId: metadata.accountId || null,
      accountName: metadata.accountName || null,
      bankName: metadata.bankName || null,
      accountType: metadata.accountType || null,
      statementPeriod: metadata.period || null,
    }));
    insights.transactions = transactions;
    insights.metrics = {
      income: analysed.summary?.totals?.income ?? 0,
      spend: analysed.summary?.totals?.spend ?? 0,
      categories: analysed.summary?.categories || [],
      topCategories: analysed.summary?.topCategories || [],
      largestExpenses: analysed.summary?.largestExpenses || [],
      spendingCanteorgies: analysed.summary?.spendingCanteorgies || [],
      extractionSource: analysed.extractionSource || null,
      account: metadata,
    };
    const docDate = firstValidDate(metadata.period?.end, metadata.period?.start, transactions[0]?.date);
    if (docDate) {
      insights.metadata = insights.metadata || {};
      insights.metadata.documentDate = docDate.toISOString();
      insights.metadata.documentMonth = docDate.format('YYYY-MM');
      insights.metadata.documentMonthLabel = docDate.format('MM/YYYY');
    }
    if (metadata.accountHolder) {
      const match = nameMatchesUser(metadata.accountHolder, userNames);
      insights.metadata.documentName = metadata.accountHolder;
      insights.metadata.nameMatchesUser = match;
      insights.metadata.accountHolder = metadata.accountHolder;
    }
    if (!Array.isArray(insights.metadata.statementPeriods)) {
      insights.metadata.statementPeriods = metadata.period ? [metadata.period] : [];
    }
    const accountLabel = [metadata.accountName, metadata.accountNumberMasked].filter(Boolean).join(' ');
    insights.narrative.push(accountLabel
      ? `Classified inflows and outflows for ${accountLabel}.`
      : 'Classified inflows and outflows from current account statement.');
    if (insights.metrics.topCategories?.length) {
      insights.narrative.push('Identified top spending categories from the latest bank statement.');
    }
  } else if (key === 'savings_account_statement' || key === 'isa_statement') {
    const balance = extractNumber(text, ['balance', 'closing balance']);
    const interest = extractNumber(text, ['interest', 'gross interest']);
    insights.metrics = {
      balance,
      interest,
    };
    insights.narrative.push('Updated balances from savings/ISA statement.');
  } else if (key === 'pension_statement') {
    const contributions = extractNumber(text, ['contribution', 'total contributions']);
    const balance = extractNumber(text, ['plan value', 'current value']);
    insights.metrics = {
      contributions,
      balance,
    };
    insights.narrative.push('Pension contribution and balance captured.');
  } else if (key === 'hmrc_correspondence') {
    const taxDue = extractNumber(text, ['tax due', 'balance outstanding']);
    insights.metrics = { taxDue };
    insights.narrative.push('HMRC correspondence ingested for tax lab.');
  } else if (key === 'supporting_receipts') {
    insights.narrative.push('Supporting evidence stored for manual review.');
  }

  return insights;
}

function validateDocument(entry, text, originalName) {
  const lowerName = normalise(originalName);
  switch (entry.key) {
    case 'payslip':
      return containsKeywords(text, ['payslip', 'gross pay', 'net pay']) || containsKeywords(lowerName, ['payslip']);
    case 'current_account_statement':
      return containsKeywords(text, ['statement', 'account number']) || containsKeywords(lowerName, ['statement']);
    case 'savings_account_statement':
      return containsKeywords(text, ['savings', 'statement']) || containsKeywords(lowerName, ['savings']);
    case 'isa_statement':
      return containsKeywords(text, ['isa', 'individual savings']) || containsKeywords(lowerName, ['isa']);
    case 'pension_statement':
      return containsKeywords(text, ['pension', 'contribution']) || containsKeywords(lowerName, ['pension']);
    case 'hmrc_correspondence':
      return containsKeywords(text, ['hm revenue', 'sa302', 'tax calculation']) || containsKeywords(lowerName, ['hmrc', 'sa302']);
    case 'supporting_receipts':
      return true;
    default:
      return false;
  }
}

async function analyseDocument(entry, buffer, originalName, context = {}) {
  const text = await extractText(buffer);
  const valid = validateDocument(entry, text, originalName);
  if (!valid) {
    return { valid: false, reason: `Uploaded file does not look like ${entry.label.toLowerCase()}.` };
  }
  return {
    valid: true,
    insights: await buildInsights(entry, text, { ...context, originalName }),
    text,
  };
}

module.exports = {
  analyseDocument,
};
