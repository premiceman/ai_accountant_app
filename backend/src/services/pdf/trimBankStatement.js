'use strict';
const pdfParse = require('pdf-parse');
const { PDFDocument } = require('pdf-lib');

const CURRENCY_REGEX = /£|\$|€|\bGBP\b|\bUSD\b|\bEUR\b/gi;
const NUMBER_REGEX = /\b\d{1,3}(?:[,\s]\d{3})*(?:\.\d{2})?\b/g;
const DATE_REGEX = /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g;
const HEADER_KEYWORDS = ['date', 'description', 'amount', 'debit', 'credit', 'balance'];

function toNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalisePages(pages, pageCount) {
  const seen = new Set();
  const output = [];
  (pages || []).forEach((p) => {
    const idx = Number(p);
    if (!Number.isInteger(idx)) return;
    if (idx < 0 || (Number.isInteger(pageCount) && idx >= pageCount)) return;
    if (seen.has(idx)) return;
    seen.add(idx);
    output.push(idx);
  });
  output.sort((a, b) => a - b);
  return output;
}

async function extractPageTexts(buffer) {
  const pages = [];
  await pdfParse(buffer, {
    pagerender: async (page) => {
      const content = await page.getTextContent();
      const text = content.items.map((item) => item.str).join(' ');
      pages.push(text);
      return text;
    },
  });
  return pages;
}

function computePageInsights(text) {
  const raw = text || '';
  const normalised = raw.replace(/\s+/g, ' ').trim();
  const include = [
    /transactions?/i,
    /statement/i,
    /\bdate\b/i,
    /\bdescription\b/i,
    /\bamount\b/i,
    /\bbalance\b/i,
    /\bdebit\b/i,
    /\bcredit\b/i,
    /opening balance/i,
    /closing balance/i,
  ];
  const exclude = [
    /glossary/i,
    /important information/i,
    /contact/i,
    /help/i,
    /fraud/i,
    /security/i,
    /terms/i,
    /conditions/i,
    /privacy/i,
    /advert/i,
    /offers?/i,
    /\bnotes?\b/i,
  ];

  let score = 0;
  include.forEach((regex) => {
    if (regex.test(normalised)) score += 2;
  });
  exclude.forEach((regex) => {
    if (regex.test(normalised)) score -= 3;
  });

  const currencyMatches = raw.match(CURRENCY_REGEX) || [];
  const numberMatches = raw.match(NUMBER_REGEX) || [];
  score += Math.min(currencyMatches.length, 20);
  score += Math.min(Math.floor(numberMatches.length / 10), 10);

  const dateMatches = raw.match(DATE_REGEX) || [];
  if (dateMatches.length >= 2) {
    score += Math.min(Math.floor(dateMatches.length / 2) + 2, 10);
  }

  const headerMatches = HEADER_KEYWORDS.filter((kw) => new RegExp(`\\b${kw}\\b`, 'i').test(normalised));
  if (headerMatches.length) {
    score += headerMatches.length * 2;
  }
  const hasHeader = headerMatches.length >= 3;

  const hasClosingBalance = /closing balance/i.test(normalised);
  if (hasClosingBalance) score += 5;

  if (/opening balance/i.test(normalised)) score += 3;

  if (numberMatches.length > 0) {
    score += Math.min(Math.floor(numberMatches.length / 8), 6);
  }
  const hasManyAmounts = numberMatches.length >= 25 || (numberMatches.length >= 15 && currencyMatches.length >= 5);

  return {
    score,
    flags: {
      hasHeader,
      hasClosingBalance,
      hasManyAmounts,
    },
  };
}

async function analyzePdf(buffer) {
  const texts = await extractPageTexts(buffer);
  const scores = [];
  const flags = [];
  for (let i = 0; i < texts.length; i++) {
    const { score, flags: pageFlags } = computePageInsights(texts[i]);
    scores[i] = score;
    flags[i] = pageFlags;
  }
  return {
    pageCount: texts.length,
    texts,
    scores,
    flags,
  };
}

function selectPages(analysis = {}, opts = {}) {
  const pageCount = Number(analysis.pageCount) || 0;
  const scores = Array.isArray(analysis.scores) ? analysis.scores : [];
  const flags = Array.isArray(analysis.flags) ? analysis.flags : [];

  const minFirst = toNumber(opts.minFirst ?? process.env.BANK_PDF_TRIM_MIN_FIRST, 2);
  const highThreshold = toNumber(opts.high ?? process.env.BANK_PDF_TRIM_HIGH_THRESHOLD, 6);
  const lowThreshold = toNumber(opts.low ?? process.env.BANK_PDF_TRIM_LOW_THRESHOLD, 3);
  const adjMargin = toNumber(opts.adjMargin ?? process.env.BANK_PDF_TRIM_ADJ_MARGIN, 1);
  const keepAllRatioRaw = opts.keepAllRatio ?? process.env.BANK_PDF_TRIM_KEEPALL_RATIO;
  const keepAllRatio = (() => {
    const ratio = Number(keepAllRatioRaw);
    return Number.isFinite(ratio) && ratio > 0 ? ratio : 0.8;
  })();

  if (pageCount <= 0) {
    return {
      keptPages: [],
      transactionRange: null,
      minFirst,
      adjMargin,
      highThreshold,
      lowThreshold,
      keepAllRatio,
    };
  }

  let startIndex = 0;
  for (let i = 0; i < pageCount; i++) {
    const flag = flags[i] || {};
    if (flag.hasHeader || (scores[i] ?? 0) >= highThreshold) {
      startIndex = i;
      break;
    }
  }

  const keep = new Set();
  let transactionRange = null;
  const closingIndex = flags.findIndex((flag) => flag && flag.hasClosingBalance);

  if (closingIndex >= 0) {
    const start = Math.min(startIndex, closingIndex);
    for (let i = start; i <= closingIndex; i++) {
      keep.add(i);
    }
    transactionRange = { start, end: closingIndex };
  } else {
    let lowStreak = 0;
    let lastKept = startIndex;
    for (let i = startIndex; i < pageCount; i++) {
      keep.add(i);
      lastKept = i;
      const flag = flags[i] || {};
      const pageScore = scores[i] ?? 0;
      if (pageScore < lowThreshold && !flag.hasHeader) {
        lowStreak += 1;
      } else {
        lowStreak = 0;
      }
      if (lowStreak >= 2) {
        keep.delete(i);
        lastKept = i - 1;
        break;
      }
    }
    if (lastKept >= startIndex) {
      transactionRange = { start: startIndex, end: lastKept };
    }
  }

  for (let i = 0; i < Math.min(minFirst, pageCount); i++) {
    keep.add(i);
  }

  if (adjMargin > 0 && keep.size) {
    const margin = Math.max(0, Math.floor(adjMargin));
    const extras = new Set();
    keep.forEach((idx) => {
      for (let j = Math.max(0, idx - margin); j <= Math.min(pageCount - 1, idx + margin); j++) {
        extras.add(j);
      }
    });
    extras.forEach((idx) => keep.add(idx));
  }

  let keptPages = Array.from(keep).filter((idx) => idx >= 0 && idx < pageCount);
  if (!keptPages.length) {
    const minimum = Math.min(minFirst || 1, pageCount);
    keptPages = Array.from({ length: minimum }, (_, i) => i);
  }
  keptPages.sort((a, b) => a - b);

  if (pageCount > 0 && keptPages.length / pageCount >= keepAllRatio) {
    keptPages = Array.from({ length: pageCount }, (_, i) => i);
    transactionRange = { start: 0, end: pageCount - 1 };
  }

  if (!transactionRange && keptPages.length) {
    transactionRange = { start: keptPages[0], end: keptPages[keptPages.length - 1] };
  }

  return {
    keptPages,
    transactionRange,
    minFirst,
    adjMargin,
    highThreshold,
    lowThreshold,
    keepAllRatio,
  };
}

async function buildTrimmedPdf(buffer, keptPages) {
  const src = await PDFDocument.load(buffer);
  const pageCount = src.getPageCount();
  const indices = normalisePages(keptPages, pageCount);

  if (!indices.length || indices.length >= pageCount) {
    return {
      buffer,
      keptPages: indices.length ? indices : Array.from({ length: pageCount }, (_, i) => i),
      originalPageCount: pageCount,
    };
  }

  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, indices);
  copied.forEach((page) => out.addPage(page));
  const trimmed = Buffer.from(await out.save());
  return {
    buffer: trimmed,
    keptPages: indices,
    originalPageCount: pageCount,
  };
}

async function trimBankStatement(buffer, opts = {}) {
  const analysis = await analyzePdf(buffer);
  const selectionOpts = Object.assign({}, opts || {});
  if (selectionOpts.high == null && selectionOpts.minScore != null) {
    selectionOpts.high = selectionOpts.minScore;
  }
  const selection = selectPages(analysis, selectionOpts);
  const result = await buildTrimmedPdf(buffer, selection.keptPages);
  return {
    buffer: result.buffer,
    keptPages: result.keptPages,
    originalPageCount: result.originalPageCount,
    scores: analysis.scores,
    scoreByPage: analysis.scores,
    transactionRange: selection.transactionRange,
    minFirst: selection.minFirst,
    adjMargin: selection.adjMargin,
    highThreshold: selection.highThreshold,
    lowThreshold: selection.lowThreshold,
  };
}

module.exports = {
  analyzePdf,
  selectPages,
  trimBankStatement,
  buildTrimmedPdf,
};
