'use strict';
const { analysePayslip } = require('../parsers/payslip');
const { analyseCurrentAccountStatement } = require('../parsers/statement');
const {
  buildUserNameSet,
  nameMatchesUser,
  stampDocumentDate,
  firstValidDate,
} = require('./metadata');

function extractNumber(text, labels) {
  const lower = String(text || '').toLowerCase();
  for (const label of labels) {
    const idx = lower.indexOf(label.toLowerCase());
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

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

async function buildPayslipInsights({ text, context }) {
  const breakdown = await analysePayslip(text || '');
  const insights = {
    baseKey: 'payslip',
    key: 'payslip',
    metrics: {},
    narrative: [],
    metadata: {
      payDate: breakdown.payDate || null,
      periodStart: breakdown.periodStart || null,
      periodEnd: breakdown.periodEnd || null,
      extractionSource: breakdown.extractionSource || null,
      personName: breakdown.employeeName || null,
      employerName: breakdown.employerName || null,
    },
  };
  const periodKey = breakdown.payDate || breakdown.periodEnd || breakdown.periodStart || null;
  if (periodKey) {
    insights.storeKey = `payslip:${periodKey}`;
  }
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
    deductions: ensureArray(breakdown.deductions),
    earnings: ensureArray(breakdown.earnings),
    allowances: ensureArray(breakdown.allowances),
    notes: ensureArray(breakdown.notes),
    extractionSource: breakdown.extractionSource || 'heuristic',
    llmNotes: ensureArray(breakdown.llmNotes),
    payDate: breakdown.payDate || null,
    periodStart: breakdown.periodStart || null,
    periodEnd: breakdown.periodEnd || null,
  };

  const userNames = buildUserNameSet(context.user || {});
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
  return insights;
}

async function buildCurrentAccountStatementInsights({ text, context, originalName }) {
  const analysed = await analyseCurrentAccountStatement(text || '');
  const metadata = analysed.metadata || {};
  const insights = {
    baseKey: 'current_account_statement',
    key: 'current_account_statement',
    metadata: {
      ...metadata,
      extractionSource: analysed.extractionSource || null,
      originalName: originalName || null,
    },
    metrics: {},
    transactions: [],
    narrative: [],
  };
  const periodKey = [metadata.accountId, metadata.period?.start, metadata.period?.end]
    .filter(Boolean)
    .join(':');
  if (periodKey) {
    insights.storeKey = `${insights.baseKey}:${periodKey}`;
  } else if (metadata.accountId) {
    insights.storeKey = `${insights.baseKey}:${metadata.accountId}`;
  }

  const transactions = ensureArray(analysed.transactions).map((tx) => ({
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
    categories: ensureArray(analysed.summary?.categories),
    topCategories: ensureArray(analysed.summary?.topCategories),
    largestExpenses: ensureArray(analysed.summary?.largestExpenses),
    spendingCanteorgies: ensureArray(analysed.summary?.spendingCanteorgies),
    extractionSource: analysed.extractionSource || null,
    account: metadata,
  };

  const userNames = buildUserNameSet(context.user || {});
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
  return insights;
}

function buildSavingsInsights({ text }) {
  const insights = {
    baseKey: 'savings_account_statement',
    key: 'savings_account_statement',
    metrics: {},
    narrative: [],
  };
  insights.metrics.balance = extractNumber(text, ['balance', 'closing balance']);
  insights.metrics.interest = extractNumber(text, ['interest', 'gross interest']);
  insights.narrative.push('Updated balances from savings/ISA statement.');
  return insights;
}

function buildIsaInsights({ text }) {
  const insights = {
    baseKey: 'isa_statement',
    key: 'isa_statement',
    metrics: {},
    narrative: [],
  };
  insights.metrics.balance = extractNumber(text, ['balance', 'closing balance']);
  insights.metrics.interest = extractNumber(text, ['interest', 'gross interest']);
  insights.narrative.push('Updated balances from savings/ISA statement.');
  return insights;
}

function buildPensionInsights({ text }) {
  const insights = {
    baseKey: 'pension_statement',
    key: 'pension_statement',
    metrics: {},
    narrative: [],
  };
  insights.metrics.contributions = extractNumber(text, ['contribution', 'total contributions']);
  insights.metrics.balance = extractNumber(text, ['plan value', 'current value']);
  insights.narrative.push('Pension contribution and balance captured.');
  return insights;
}

function buildHmrcInsights({ text }) {
  const insights = {
    baseKey: 'hmrc_correspondence',
    key: 'hmrc_correspondence',
    metrics: {},
    narrative: [],
  };
  insights.metrics.taxDue = extractNumber(text, ['tax due', 'balance outstanding']);
  insights.narrative.push('HMRC correspondence ingested for tax lab.');
  return insights;
}

function buildSupportingInsights() {
  return {
    baseKey: 'supporting_receipts',
    key: 'supporting_receipts',
    metrics: {},
    narrative: ['Supporting evidence stored for manual review.'],
  };
}

const BUILDERS = {
  payslip: buildPayslipInsights,
  current_account_statement: buildCurrentAccountStatementInsights,
  savings_account_statement: async (params) => buildSavingsInsights(params),
  isa_statement: async (params) => buildIsaInsights(params),
  pension_statement: async (params) => buildPensionInsights(params),
  hmrc_correspondence: async (params) => buildHmrcInsights(params),
  supporting_receipts: async () => buildSupportingInsights(),
};

async function buildInsights({ key, text, context = {}, originalName }) {
  const builder = BUILDERS[key];
  if (!builder) return null;
  return builder({ text, context, originalName });
}

module.exports = {
  buildInsights,
};
