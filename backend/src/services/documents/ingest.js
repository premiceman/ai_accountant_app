const pdfParse = require('pdf-parse');
const { analysePayslip } = require('./parsers/payslip');

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

function parseStatementDate(str) {
  if (!str) return null;
  const trimmed = str.trim();
  const iso = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const dmy = trimmed.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (dmy) {
    const [day, month, yearRaw] = [dmy[1], dmy[2], dmy[3]];
    const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const monText = trimmed.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s*(\d{2,4})?/);
  if (monText) {
    const monthNames = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', sept: '09', oct: '10', nov: '11', dec: '12',
    };
    const monthKey = monText[2].slice(0, 3).toLowerCase();
    const month = monthNames[monthKey];
    if (month) {
      const yearRaw = monText[3] || String(new Date().getFullYear());
      const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw.padStart(4, '0');
      return `${year}-${month}-${String(monText[1]).padStart(2, '0')}`;
    }
  }
  return null;
}

function parseStatementTransactions(text) {
  const lines = String(text || '').split(/\r?\n+/).map((l) => l.trim()).filter(Boolean);
  const categories = {
    income: ['salary', 'payroll', 'payslip', 'hmrc', 'bonus'],
    housing: ['rent', 'mortgage'],
    groceries: ['tesco', 'sainsbury', 'waitrose', 'aldi', 'lidl', 'morrison'],
    subscriptions: ['netflix', 'spotify', 'prime', 'icloud', 'google'],
    utilities: ['edf', 'octopus', 'british gas', 'thames water', 'ee', 'o2', 'vodafone'],
    savings: ['transfer', 'savings', 'isa'],
    shopping: ['amazon', 'apple', 'currys', 'argos'],
  };
  const transactions = [];
  for (const line of lines) {
    const amountMatch = line.match(/(-?£?\d[\d,]*\.?\d{0,2})\s*(dr|cr)?$/i);
    if (!amountMatch) continue;
    let amount = Number(amountMatch[1].replace(/[,£]/g, ''));
    if (!Number.isFinite(amount)) continue;
    const debitCredit = amountMatch[2] ? amountMatch[2].toLowerCase() : null;
    if (debitCredit === 'dr') amount = -Math.abs(amount);
    if (debitCredit === 'cr') amount = Math.abs(amount);
    const withoutAmount = line.replace(amountMatch[0], '').trim();
    const dateMatch = withoutAmount.match(/^[0-9]{1,2}[^A-Za-z0-9]?\s*[A-Za-z]{3,9}\s*[0-9]{0,4}/)
      || withoutAmount.match(/^[0-9]{1,2}[\/\-.][0-9]{1,2}[\/\-.][0-9]{2,4}/)
      || withoutAmount.match(/^[0-9]{4}-[0-9]{2}-[0-9]{2}/);
    let description = withoutAmount;
    let date = null;
    if (dateMatch) {
      date = parseStatementDate(dateMatch[0]);
      description = withoutAmount.slice(dateMatch[0].length).trim();
    }
    const descLower = normalise(description);
    let category = 'other';
    for (const [cat, probes] of Object.entries(categories)) {
      if (probes.some((probe) => descLower.includes(probe))) {
        category = cat;
        break;
      }
    }
    const direction = amount >= 0 ? 'inflow' : 'outflow';
    transactions.push({ description: description || 'Transaction', amount, category, direction, date });
  }
  const totals = transactions.reduce((acc, tx) => {
    if (tx.direction === 'inflow') acc.income += tx.amount;
    else acc.spend += Math.abs(tx.amount);
    return acc;
  }, { income: 0, spend: 0 });
  return { transactions, totals };
}

function summariseTransactions(transactions) {
  const groups = {};
  for (const tx of transactions) {
    const key = tx.category || 'other';
    if (!groups[key]) groups[key] = { category: key, inflow: 0, outflow: 0 };
    if (tx.direction === 'inflow') groups[key].inflow += tx.amount;
    else groups[key].outflow += Math.abs(tx.amount);
  }
  return Object.values(groups).sort((a, b) => (b.outflow || b.inflow) - (a.outflow || a.inflow));
}

async function buildInsights(entry, text) {
  const key = entry.key;
  const insights = { key, metrics: {}, narrative: [] };

  if (key === 'payslip') {
    const breakdown = await analysePayslip(text || '');
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
    };
    if (insights.metrics.notes.length) {
      insights.narrative.push(...insights.metrics.notes);
    } else {
      insights.narrative.push('Earnings and deductions extracted from payslip.');
    }
  } else if (key === 'current_account_statement') {
    const parsed = parseStatementTransactions(text);
    insights.transactions = parsed.transactions;
    insights.metrics = {
      income: parsed.totals.income,
      spend: parsed.totals.spend,
      categories: summariseTransactions(parsed.transactions),
      topCategories: summariseTransactions(parsed.transactions)
        .filter((cat) => cat.outflow)
        .slice(0, 5)
        .map((cat) => ({
          category: cat.category,
          outflow: cat.outflow,
          inflow: cat.inflow,
        })),
      largestExpenses: parsed.transactions
        .filter((tx) => tx.direction === 'outflow')
        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
        .slice(0, 5)
        .map((tx) => ({
          description: tx.description,
          amount: Math.abs(tx.amount),
          category: tx.category,
          date: tx.date || null,
        })),
    };
    insights.narrative.push('Classified inflows and outflows from current account statement.');
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

async function analyseDocument(entry, buffer, originalName) {
  const text = await extractText(buffer);
  const valid = validateDocument(entry, text, originalName);
  if (!valid) {
    return { valid: false, reason: `Uploaded file does not look like ${entry.label.toLowerCase()}.` };
  }
  return {
    valid: true,
    insights: await buildInsights(entry, text),
    text,
  };
}

module.exports = {
  analyseDocument,
};
