const { callStructuredExtraction } = require('../openaiClient');

const CATEGORY_CANONICAL = new Map([
  ['income', 'Income'],
  ['salary', 'Income'],
  ['payroll', 'Income'],
  ['bonus', 'Income'],
  ['groceries', 'Groceries'],
  ['supermarket', 'Groceries'],
  ['food', 'Groceries'],
  ['meals', 'Meals Out'],
  ['dining', 'Meals Out'],
  ['restaurant', 'Meals Out'],
  ['entertainment', 'Entertainment'],
  ['subscription', 'Entertainment'],
  ['travel', 'Travel'],
  ['transport', 'Travel'],
  ['commuting', 'Travel'],
  ['car', 'Car expenses'],
  ['auto', 'Car expenses'],
  ['fuel', 'Car expenses'],
  ['petrol', 'Car expenses'],
  ['rent', 'Rent/Mortgage'],
  ['mortgage', 'Rent/Mortgage'],
  ['housing', 'Rent/Mortgage'],
  ['utilities', 'Utilities'],
  ['energy', 'Utilities'],
  ['insurance', 'Insurance'],
  ['health', 'Healthcare'],
  ['medical', 'Healthcare'],
  ['education', 'Education'],
  ['tuition', 'Education'],
  ['childcare', 'Education'],
  ['savings', 'Savings'],
  ['investment', 'Investments'],
  ['investments', 'Investments'],
  ['transfer', 'Transfers'],
  ['fees', 'Fees'],
  ['charges', 'Fees'],
]);

const CATEGORY_LIST = [
  'Income',
  'Groceries',
  'Meals Out',
  'Entertainment',
  'Travel',
  'Car expenses',
  'Rent/Mortgage',
  'Utilities',
  'Insurance',
  'Healthcare',
  'Education',
  'Savings',
  'Investments',
  'Transfers',
  'Fees',
  'Other',
];

function normaliseCategory(raw) {
  if (!raw) return 'Other';
  const key = String(raw).toLowerCase().trim();
  if (CATEGORY_CANONICAL.has(key)) return CATEGORY_CANONICAL.get(key);
  for (const [alias, canonical] of CATEGORY_CANONICAL.entries()) {
    if (key.includes(alias)) return canonical;
  }
  const normalized = key.replace(/[^a-z]+/g, ' ').trim();
  if (CATEGORY_CANONICAL.has(normalized)) return CATEGORY_CANONICAL.get(normalized);
  if (CATEGORY_LIST.includes(capitalize(raw))) return capitalize(raw);
  return 'Other';
}

function capitalize(str) {
  const text = String(str || '').trim();
  if (!text) return '';
  return text.slice(0, 1).toUpperCase() + text.slice(1);
}

function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 60) || 'account';
}

function maskAccountNumber(value) {
  const digits = String(value || '').replace(/\D+/g, '');
  if (!digits) return null;
  const last4 = digits.slice(-4);
  return `•••• ${last4}`;
}

function parseNumber(value) {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseDate(value) {
  if (!value) return null;
  const iso = new Date(value);
  if (!Number.isNaN(iso.getTime())) return iso.toISOString().slice(0, 10);
  const match = String(value).match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (match) {
    const d = match[1].padStart(2, '0');
    const m = match[2].padStart(2, '0');
    const y = match[3].length === 2 ? `20${match[3]}` : match[3];
    return `${y}-${m}-${d}`;
  }
  return null;
}

function normaliseIsoDate(value) {
  if (!value) return null;
  const direct = value instanceof Date ? value : new Date(value);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();
  const parsed = parseDate(value);
  if (parsed) {
    const iso = new Date(parsed);
    if (!Number.isNaN(iso.getTime())) return iso.toISOString();
  }
  return null;
}

function derivePeriodFromTransactions(transactions) {
  const dates = transactions
    .map((tx) => normaliseIsoDate(tx.date))
    .filter(Boolean)
    .sort();
  if (!dates.length) return { start: null, end: null };
  return { start: dates[0], end: dates[dates.length - 1] };
}

function normaliseTransactions(list, metadata) {
  if (!Array.isArray(list)) return [];
  return list
    .map((tx, idx) => {
      const amount = parseNumber(tx.amount);
      if (!Number.isFinite(amount)) return null;
      const direction = amount >= 0 ? 'inflow' : 'outflow';
      const category = normaliseCategory(tx.category || tx.type);
      const date = parseDate(tx.date) || metadata?.period?.start || null;
      return {
        id: `${metadata?.accountId || 'account'}-${idx}`,
        description: String(tx.description || tx.merchant || 'Transaction').trim(),
        amount,
        direction,
        category,
        date,
        rawCategory: tx.category || tx.type || null,
        counterparty: tx.counterparty || null,
        transfer:
          category === 'Transfers'
          || /transfer|internal|between accounts/i.test(String(tx.description || '')),
      };
    })
    .filter(Boolean);
}

function summariseCategories(transactions) {
  const groups = new Map();
  for (const tx of transactions) {
    const key = tx.category || 'Other';
    const item = groups.get(key) || { category: key, inflow: 0, outflow: 0 };
    if (tx.direction === 'inflow') item.inflow += tx.amount;
    else item.outflow += Math.abs(tx.amount);
    groups.set(key, item);
  }
  return Array.from(groups.values()).sort((a, b) => (b.outflow || b.inflow) - (a.outflow || a.inflow));
}

async function llmCategoriseTransactions(transactions) {
  const targets = transactions
    .map((tx, index) => ({ tx, index }))
    .filter(({ tx }) => !tx.category || tx.category === 'Other')
    .slice(0, 60);
  if (!targets.length) return transactions;

  const schema = {
    name: 'transaction_categorisation',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        categories: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              index: { type: 'number' },
              category: { type: 'string' },
            },
          },
        },
      },
    },
    strict: true,
  };

  const lines = targets
    .map(({ tx, index }) => {
      const direction = tx.direction || (Number(tx.amount) >= 0 ? 'inflow' : 'outflow');
      const amount = Math.abs(Number(tx.amount) || 0).toFixed(2);
      const date = tx.date || 'unknown date';
      const description = tx.description || 'Transaction';
      return `#${index} | ${date} | ${direction.toUpperCase()} | £${amount} | ${description}`;
    })
    .join('\n');

  const prompt = [
    'Classify each bank transaction into the most appropriate high-level spending category.',
    `Allowed categories: ${CATEGORY_LIST.join(', ')}.`,
    'Prefer specific spending categories (e.g. Groceries, Travel). Use Transfers for movements between own accounts.',
    'Return an array of objects with the transaction index and the chosen category label.',
    'Transactions to classify:',
    lines,
  ].join('\n');

  const response = await callStructuredExtraction(prompt, schema, {
    systemPrompt: 'You are a meticulous accountant categorising bank statement transactions for analytics.',
    maxTokens: 1200,
  });

  const updates = Array.isArray(response?.categories) ? response.categories : [];
  updates.forEach((item) => {
    const idx = Number(item.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= transactions.length) return;
    const category = normaliseCategory(item.category);
    if (!category) return;
    transactions[idx].category = category;
  });

  return transactions;
}

async function llmStatementExtraction(text) {
  const schema = {
    name: 'statement_extraction',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        bank_name: { type: ['string', 'null'] },
        account_number: { type: ['string', 'null'] },
        account_type: { type: ['string', 'null'] },
        statement_period: {
          type: 'object',
          additionalProperties: false,
          properties: {
            start_date: { type: ['string', 'null'] },
            end_date: { type: ['string', 'null'] },
          },
        },
        transactions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              date: { type: ['string', 'null'] },
              description: { type: ['string', 'null'] },
              amount: { type: ['number', 'string'] },
              category: { type: ['string', 'null'] },
              direction: { type: ['string', 'null'] },
              counterparty: { type: ['string', 'null'] },
            },
          },
        },
        totals: {
          type: 'object',
          additionalProperties: false,
          properties: {
            income: { type: ['number', 'null'] },
            spend: { type: ['number', 'null'] },
          },
        },
      },
    },
    strict: true,
  };

  const prompt = [
    'You are analysing a UK bank current account statement. Extract every transaction with ISO dates (YYYY-MM-DD), amounts (use',
    ' negative values for money leaving the account), and map each transaction into one of the allowed high level categories:',
    CATEGORY_LIST.join(', '),
    'Use "Transfers" for movements between own accounts and "Other" if unsure. Provide the bank name, account type and the stat',
    'ement period.',
    '',
    text.slice(0, 6000),
  ].join('\n');

  return callStructuredExtraction(prompt, schema, {
    systemPrompt: 'You are a meticulous forensic accountant that extracts structured banking transactions for analytics.',
    maxTokens: 2000,
  });
}

function heuristicStatementParsing(text) {
  const lines = String(text || '')
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const transactions = [];
  const dateRegex = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/;
  for (const line of lines) {
    const amountMatch = line.match(/(-?£?\d[\d,]*\.?\d{0,2})\s*(cr|dr)?$/i);
    if (!amountMatch) continue;
    const rawAmount = amountMatch[1].replace(/[,£\s]/g, '');
    let amount = Number.parseFloat(rawAmount);
    if (!Number.isFinite(amount)) continue;
    const directionToken = amountMatch[2]?.toLowerCase();
    if (directionToken === 'dr' && amount > 0) amount = -amount;
    if (directionToken === 'cr' && amount < 0) amount = Math.abs(amount);
    const detail = line.slice(0, line.length - amountMatch[0].length).trim();
    const dateMatch = detail.match(dateRegex);
    let date = null;
    let description = detail;
    if (dateMatch) {
      date = `${dateMatch[3].length === 2 ? `20${dateMatch[3]}` : dateMatch[3]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[1].padStart(2, '0')}`;
      description = detail.slice(dateMatch[0].length).trim();
    }
    const lower = description.toLowerCase();
    let category = 'Other';
    if (/tesco|waitrose|sainsbury|aldi|lidl|asda/.test(lower)) category = 'Groceries';
    else if (/uber|trainline|tfl|rail|hotel|airbnb/.test(lower)) category = 'Travel';
    else if (/shell|bp|esso|petrol|fuel/.test(lower)) category = 'Car expenses';
    else if (/netflix|spotify|disney|prime|entertain/.test(lower)) category = 'Entertainment';
    else if (/restaurant|cafe|coffee|food|eat|dining/.test(lower)) category = 'Meals Out';
    else if (/rent|mortgage|landlord/.test(lower)) category = 'Rent/Mortgage';
    else if (/transfer|to savings|isa|standing order/.test(lower)) category = 'Transfers';
    transactions.push({
      id: `heuristic-${transactions.length}`,
      description: description || 'Transaction',
      amount,
      direction: amount >= 0 ? 'inflow' : 'outflow',
      category,
      date,
      rawCategory: category,
      counterparty: null,
      transfer: category === 'Transfers',
    });
  }
  return transactions;
}

function summariseStatement(transactions) {
  const totals = transactions.reduce((acc, tx) => {
    if (tx.direction === 'inflow') acc.income += tx.amount;
    else acc.spend += Math.abs(tx.amount);
    return acc;
  }, { income: 0, spend: 0 });

  const categories = summariseCategories(transactions);
  const totalOutflow = categories.reduce((acc, cat) => acc + (cat.outflow || 0), 0);
  const spendingCanteorgies = categories
    .filter((cat) => cat.outflow || cat.amount)
    .map((cat) => ({
      label: cat.category,
      category: cat.category,
      amount: cat.outflow || cat.amount || 0,
      outflow: cat.outflow || 0,
      inflow: cat.inflow || 0,
      share: totalOutflow ? (cat.outflow || cat.amount || 0) / totalOutflow : 0,
    }));
  const topCategories = categories.filter((c) => c.outflow).slice(0, 5).map((cat) => ({
    category: cat.category,
    outflow: cat.outflow,
    inflow: cat.inflow,
  }));
  const largestExpenses = transactions
    .filter((tx) => tx.direction === 'outflow' && !tx.transfer)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, 5)
    .map((tx) => ({
      description: tx.description,
      amount: Math.abs(tx.amount),
      category: tx.category,
      date: tx.date,
    }));

  return { totals, categories, topCategories, largestExpenses, spendingCanteorgies };
}

async function analyseCurrentAccountStatement(text) {
  const llm = await llmStatementExtraction(text || '');
  const metadata = {
    bankName: llm?.bank_name || null,
    accountType: llm?.account_type || null,
    accountNumberMasked: maskAccountNumber(llm?.account_number),
    period: {
      start: parseDate(llm?.statement_period?.start_date) || null,
      end: parseDate(llm?.statement_period?.end_date) || null,
    },
  };
  const accountKeyBase = [metadata.bankName, metadata.accountType, metadata.accountNumberMasked]
    .filter(Boolean)
    .join(' ');
  metadata.accountId = slugify(accountKeyBase || 'current-account');
  metadata.accountName = [metadata.bankName, metadata.accountType].filter(Boolean).join(' ') || 'Current account';

  const llmTransactions = normaliseTransactions(llm?.transactions, metadata);
  const heuristicTransactions = heuristicStatementParsing(text || '');
  const mergedTransactions = llmTransactions.length ? llmTransactions : heuristicTransactions;

  await llmCategoriseTransactions(mergedTransactions);

  const derivedPeriod = derivePeriodFromTransactions(mergedTransactions);
  if (!metadata.period.start && derivedPeriod.start) metadata.period.start = derivedPeriod.start.slice(0, 10);
  if (!metadata.period.end && derivedPeriod.end) metadata.period.end = derivedPeriod.end.slice(0, 10);

  const summary = summariseStatement(mergedTransactions);
  if (!summary.totals.income && llm?.totals?.income) summary.totals.income = parseNumber(llm.totals.income) || 0;
  if (!summary.totals.spend && llm?.totals?.spend) summary.totals.spend = Math.abs(parseNumber(llm.totals.spend) || 0);

  return {
    metadata,
    transactions: mergedTransactions,
    summary,
    extractionSource: llmTransactions.length ? 'openai' : 'heuristic',
  };
}

module.exports = {
  analyseCurrentAccountStatement,
  normaliseCategory,
  summariseStatement,
};

