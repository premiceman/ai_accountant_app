'use strict';

const { normaliseText } = require('./metadata');
const { getCatalogueEntry } = require('../catalogue');

const TEXT_RULES = Object.freeze({
  payslip: {
    keywords: ['payslip', 'gross pay', 'net pay', 'ni number', 'tax code', 'national insurance'],
    filename: ['payslip', 'pay-slip'],
  },
  current_account_statement: {
    keywords: ['statement', 'account number', 'sort code', 'transaction details', 'closing balance', 'available balance'],
    filename: ['statement', 'bank'],
  },
  savings_account_statement: {
    keywords: ['savings', 'statement', 'interest earned', 'balance brought forward'],
    filename: ['savings'],
  },
  isa_statement: {
    keywords: ['isa', 'individual savings', 'isa allowance', 'subscription', 'stocks and shares isa'],
    filename: ['isa'],
  },
  pension_statement: {
    keywords: ['pension', 'contribution', 'plan value', 'pension input amount', 'scheme value'],
    filename: ['pension'],
  },
  hmrc_correspondence: {
    keywords: ['hm revenue', 'hmrc', 'self assessment', 'sa302', 'tax calculation', 'payable by'],
    filename: ['hmrc', 'sa302'],
  },
  supporting_receipts: {
    keywords: ['receipt', 'invoice', 'payment received'],
    filename: ['receipt', 'invoice'],
  },
});

function scoreKeywords(content, keywords = []) {
  const lower = normaliseText(content);
  const matches = [];
  let score = 0;
  for (const keyword of keywords) {
    if (!keyword) continue;
    const needle = keyword.toLowerCase();
    if (lower.includes(needle)) {
      score += 1;
      matches.push(needle);
    }
  }
  return { score, matches };
}

function classifyDocument({ text, originalName }) {
  const results = [];
  const trimmed = (text || '').trim();
  const fileName = originalName || '';

  for (const [key, rule] of Object.entries(TEXT_RULES)) {
    const catalogueEntry = getCatalogueEntry(key);
    if (!catalogueEntry) continue;
    const { score: textScore, matches: textMatches } = scoreKeywords(trimmed, rule.keywords);
    const { score: nameScore, matches: nameMatches } = scoreKeywords(fileName, rule.filename);
    const score = (textScore * 2) + nameScore;
    if (score <= 0) continue;
    results.push({
      key,
      label: catalogueEntry.label || key,
      score,
      matches: [...new Set([...textMatches, ...nameMatches])],
    });
  }

  if (!results.length) {
    return {
      key: null,
      confidence: 0,
      matches: [],
    };
  }

  results.sort((a, b) => b.score - a.score);
  const best = results[0];
  const confidence = best.score / Math.max(5, best.score + results.slice(1).reduce((acc, r) => acc + r.score, 0));
  return {
    key: best.key,
    label: best.label,
    confidence,
    matches: best.matches,
  };
}

module.exports = {
  classifyDocument,
};
