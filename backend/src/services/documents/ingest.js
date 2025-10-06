const pdfParse = require('pdf-parse');

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
    const snippet = text.slice(Math.max(0, idx - 12), idx + 60);
    const match = snippet.match(/(-?\d[\d,.]*)(?:\s*(?:£|gbp))?/i) || snippet.match(/£\s*(-?[\d,.]+)/i);
    if (match) {
      return Number(match[1].replace(/[,£\s]/g, ''));
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
    const amountMatch = line.match(/(-?£?\d[\d,]*\.?\d{0,2})$/);
    if (!amountMatch) continue;
    const amount = Number(amountMatch[1].replace(/[,£]/g, ''));
    const description = line.replace(amountMatch[0], '').trim();
    const descLower = normalise(description);
    let category = 'other';
    for (const [cat, probes] of Object.entries(categories)) {
      if (probes.some((probe) => descLower.includes(probe))) {
        category = cat;
        break;
      }
    }
    const direction = amount >= 0 ? 'inflow' : 'outflow';
    transactions.push({ description, amount, category, direction });
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

function buildInsights(entry, text) {
  const key = entry.key;
  const insights = { key, metrics: {}, narrative: [] };

  if (key === 'payslip') {
    const gross = extractNumber(text, ['gross pay', 'total gross']);
    const net = extractNumber(text, ['net pay', 'take home']);
    const tax = extractNumber(text, ['tax', 'income tax']);
    const ni = extractNumber(text, ['national insurance']);
    const pension = extractNumber(text, ['pension', 'employee pension']);
    insights.metrics = {
      gross,
      net,
      tax,
      ni,
      pension,
    };
    insights.narrative.push('Earnings and deductions extracted from payslip.');
  } else if (key === 'current_account_statement') {
    const parsed = parseStatementTransactions(text);
    insights.transactions = parsed.transactions;
    insights.metrics = {
      income: parsed.totals.income,
      spend: parsed.totals.spend,
      categories: summariseTransactions(parsed.transactions),
    };
    insights.narrative.push('Classified inflows and outflows from current account statement.');
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
    insights: buildInsights(entry, text),
    text,
  };
}

module.exports = {
  analyseDocument,
};
