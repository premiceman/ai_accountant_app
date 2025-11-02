const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const isSameOrBefore = require('dayjs/plugin/isSameOrBefore');
const isSameOrAfter = require('dayjs/plugin/isSameOrAfter');
const duration = require('dayjs/plugin/duration');
const { Types, connection } = require('mongoose');

const AnalyticsSnapshot = require('../../../models/AnalyticsSnapshot');
const Record = require('../../../models/Record');

dayjs.extend(utc);
dayjs.extend(isSameOrBefore);
dayjs.extend(isSameOrAfter);
dayjs.extend(duration);

const INCOME_REGEX = /(payroll|salary|payment received|refund)/i;
const REFUND_REGEX = /refund/i;

const SPEND_KEYWORDS = [
  { name: 'Housing (Rent/Mortgage)', pattern: /(rent|mortgage|landlord|lettings|estate)/i },
  { name: 'Utilities/Energy', pattern: /(utility|energy|electric|gas|water|power|edf|octopus|british gas)/i },
  { name: 'Groceries', pattern: /(supermarket|grocery|tesco|sainsbury|aldi|lidl|waitrose|co-?op|asda|morrisons|whole ?foods|iceland)/i },
  { name: 'Transport', pattern: /(uber|lyft|bolt|train|rail|tfl|transport|bus|petrol|fuel|shell|bp|parking|taxi|flight|airline)/i },
  { name: 'Subscriptions', pattern: /(subscription|netflix|spotify|prime|icloud|apple|google|microsoft|adobe|patreon|now tv|disney|itunes)/i },
  { name: 'Leisure', pattern: /(restaurant|cafe|coffee|bar|pub|cinema|theatre|gym|fitness|holiday|travel|airbnb|hotel|ticket|event)/i },
  { name: 'Fees/Charges', pattern: /(fee|charge|interest|overdraft|penalty|fine)/i },
];

const ESSENTIAL_CATEGORY_NAMES = new Set([
  'Housing (Rent/Mortgage)',
  'Utilities/Energy',
  'Groceries',
  'Transport',
]);

const MONTH_REGEX = /^\d{4}-\d{2}$/;

const pendingRecomputes = new Map();
let changeStream = null;
let engineStarted = false;

function assertValidMonth(month) {
  if (!MONTH_REGEX.test(month)) {
    throw new Error(`Invalid period month ${month}`);
  }
}

function normaliseUserId(userId) {
  if (!userId) {
    throw new Error('User id required');
  }
  if (userId instanceof Types.ObjectId) {
    return userId;
  }
  if (typeof userId === 'string' && Types.ObjectId.isValid(userId)) {
    return new Types.ObjectId(userId);
  }
  throw new Error('Invalid user id');
}

function getMonthRange(month) {
  assertValidMonth(month);
  const start = dayjs.utc(`${month}-01`).startOf('month');
  const end = start.endOf('month');
  return {
    month,
    start,
    end,
    startStr: start.format('YYYY-MM-DD'),
    endStr: end.format('YYYY-MM-DD'),
  };
}

function parseMonthFromDate(dateStr) {
  if (typeof dateStr !== 'string') return null;
  const match = dateStr.match(/^(\d{4}-\d{2})/);
  return match ? match[1] : null;
}

function monthsBetween(startStr, endStr) {
  const start = dayjs.utc(startStr || null);
  const end = dayjs.utc(endStr || null);
  if (!start.isValid() && !end.isValid()) return [];
  const effectiveStart = start.isValid() ? start.startOf('month') : end.startOf('month');
  const effectiveEnd = end.isValid() ? end.startOf('month') : start.startOf('month');
  if (!effectiveStart.isValid() || !effectiveEnd.isValid()) return [];
  const months = [];
  let cursor = effectiveStart;
  const limit = 120; // guard against infinite loops
  while (cursor.isSameOrBefore(effectiveEnd) && months.length < limit) {
    months.push(cursor.format('YYYY-MM'));
    cursor = cursor.add(1, 'month');
  }
  return months;
}

function safeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function roundCurrency(value) {
  if (value == null) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 100) / 100;
}

function categoriseSpend(description) {
  if (!description) return 'Other';
  const lower = String(description).toLowerCase();
  for (const entry of SPEND_KEYWORDS) {
    if (entry.pattern.test(lower)) {
      return entry.name;
    }
  }
  return 'Other';
}

function isWithinMonth(dateStr, range) {
  if (!dateStr) return false;
  const parsed = dayjs.utc(dateStr);
  if (!parsed.isValid()) return false;
  return parsed.isSameOrAfter(range.start) && parsed.isSameOrBefore(range.end);
}

function addIncomeSource(map, name, amount) {
  if (!amount) return;
  const key = name || 'Income';
  const current = map.get(key) || 0;
  map.set(key, current + amount);
}

async function aggregatePayslipData(userObjectId, range) {
  const monthDocs = await Record.find({
    userId: userObjectId,
    type: 'payslip',
    'normalized.payDate': { $gte: range.startStr, $lte: range.endStr },
  })
    .lean()
    .exec();

  const incomeSources = new Map();
  let grossTotal = 0;
  let netTotal = 0;

  for (const doc of monthDocs) {
    const totals = (doc.normalized?.totals || {});
    const employerName = doc.normalized?.employer?.name || 'Salary';
    const net = safeNumber(totals.net);
    const gross = safeNumber(totals.gross);
    grossTotal += gross;
    netTotal += net;
    addIncomeSource(incomeSources, employerName || 'Salary', net);
  }

  const yearStart = range.start.startOf('year').format('YYYY-MM-DD');
  const ytdDocs = await Record.find({
    userId: userObjectId,
    type: 'payslip',
    'normalized.payDate': { $gte: yearStart, $lte: range.endStr },
  })
    .lean()
    .exec();

  let incomeTaxYTD = 0;
  let niYTD = 0;
  let studentLoanYTD = 0;
  let pensionYTD = 0;

  for (const doc of ytdDocs) {
    const totals = doc.normalized?.totals || {};
    incomeTaxYTD += safeNumber(totals.incomeTax);
    niYTD += safeNumber(totals.nationalInsurance);
    studentLoanYTD += safeNumber(totals.studentLoan);
    pensionYTD += safeNumber(totals.pension);
  }

  return {
    incomeSources,
    grossTotal: roundCurrency(grossTotal) || 0,
    netTotal: roundCurrency(netTotal) || 0,
    taxes: {
      incomeTaxYTD: roundCurrency(incomeTaxYTD) || 0,
      niYTD: roundCurrency(niYTD) || 0,
      studentLoanYTD: roundCurrency(studentLoanYTD) || 0,
      pensionYTD: roundCurrency(pensionYTD) || 0,
    },
    monthPayslips: monthDocs.length,
  };
}

async function aggregateStatementData(userObjectId, range, hasPayslip) {
  const statements = await Record.find({
    userId: userObjectId,
    type: 'bankStatement',
    $or: [
      { 'normalized.period.start': { $lte: range.endStr, $gte: range.startStr } },
      { 'normalized.period.end': { $gte: range.startStr, $lte: range.endStr } },
      {
        $and: [
          { 'normalized.period.start': { $lte: range.startStr } },
          { 'normalized.period.end': { $gte: range.endStr } },
        ],
      },
    ],
  })
    .lean()
    .exec();

  const incomeSources = new Map();
  const spendBuckets = new Map();
  const monthTransactions = [];
  const anomalies = [];

  let openingBalance = null;
  let closingBalance = null;
  let openingReference = null;
  let closingReference = null;

  for (const statement of statements) {
    const normalized = statement.normalized || {};
    const period = normalized.period || {};
    const statementMonths = monthsBetween(period.start, period.end);
    if (statementMonths.length) {
      const startMoment = dayjs.utc(period.start || `${statementMonths[0]}-01`);
      const endMoment = dayjs.utc(period.end || `${statementMonths[statementMonths.length - 1]}-01`).endOf('month');
      if (openingBalance == null && normalized.openingBalance != null) {
        openingBalance = roundCurrency(normalized.openingBalance);
        openingReference = startMoment;
      } else if (openingBalance != null && normalized.openingBalance != null && startMoment.isBefore(openingReference)) {
        openingBalance = roundCurrency(normalized.openingBalance);
        openingReference = startMoment;
      }
      if (normalized.closingBalance != null) {
        const closingMoment = endMoment;
        if (closingBalance == null || closingMoment.isAfter(closingReference)) {
          closingBalance = roundCurrency(normalized.closingBalance);
          closingReference = closingMoment;
        }
      }
    }

    const transactions = Array.isArray(normalized.transactions) ? normalized.transactions : [];
    for (const tx of transactions) {
      if (!isWithinMonth(tx.date, range)) continue;
      const amount = Number(tx.amount);
      if (!Number.isFinite(amount)) continue;
      const direction = tx.direction === 'outflow' ? 'outflow' : 'inflow';
      const description = tx.description || '';
      const abs = Math.abs(amount);
      if (direction === 'inflow') {
        if (abs > 200 && INCOME_REGEX.test(description)) {
          if (!(hasPayslip && !REFUND_REGEX.test(description))) {
            const bucketName = REFUND_REGEX.test(description) ? 'Refunds' : 'Income';
            addIncomeSource(incomeSources, bucketName, abs);
          }
        }
      } else {
        const category = categoriseSpend(description);
        const current = spendBuckets.get(category) || 0;
        spendBuckets.set(category, current + abs);
      }
      monthTransactions.push({ direction, amount: abs, date: tx.date, description });
    }
  }

  const cleanedTransactions = [];
  const seen = new Set();
  for (const entry of monthTransactions) {
    const key = `${entry.direction}:${entry.amount}:${entry.date}:${entry.description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cleanedTransactions.push(entry);
  }

  const spendTotal = cleanedTransactions
    .filter((tx) => tx.direction === 'outflow')
    .reduce((acc, tx) => acc + tx.amount, 0);

  const largeOutflowThreshold = spendTotal ? Math.max(1000, spendTotal * 0.5) : 1000;
  const largeInflowThreshold = 5000;

  for (const tx of cleanedTransactions) {
    const txDate = tx.date ? dayjs.utc(tx.date) : null;
    const date = txDate && txDate.isValid() ? txDate.toDate() : range.end.toDate();
    if (tx.direction === 'outflow' && tx.amount >= largeOutflowThreshold) {
      anomalies.push({
        kind: 'large_spend',
        amount: roundCurrency(tx.amount) || 0,
        date,
        note: tx.description || null,
      });
    }
    if (tx.direction === 'inflow' && tx.amount >= largeInflowThreshold) {
      anomalies.push({
        kind: 'large_income',
        amount: roundCurrency(tx.amount) || 0,
        date,
        note: tx.description || null,
      });
    }
  }

  return {
    incomeSources,
    spendBuckets,
    spendTotal: roundCurrency(spendTotal) || 0,
    openingBalance,
    closingBalance,
    anomalies,
  };
}

async function computeSnapshotDocument(userId, month) {
  const userObjectId = normaliseUserId(userId);
  const range = getMonthRange(month);

  const payslipData = await aggregatePayslipData(userObjectId, range);
  const statementData = await aggregateStatementData(userObjectId, range, payslipData.monthPayslips > 0);

  // merge income sources
  const combinedIncomeSources = new Map();
  for (const [name, total] of payslipData.incomeSources.entries()) {
    addIncomeSource(combinedIncomeSources, name, total);
  }
  for (const [name, total] of statementData.incomeSources.entries()) {
    addIncomeSource(combinedIncomeSources, name, total);
  }

  const incomeSourcesArray = Array.from(combinedIncomeSources.entries())
    .map(([name, total]) => ({ name, total: roundCurrency(total) || 0 }))
    .filter((entry) => entry.total !== 0)
    .sort((a, b) => b.total - a.total);

  const incomeTotal = roundCurrency(
    incomeSourcesArray.reduce((acc, entry) => acc + (entry.total || 0), 0)
  ) || 0;

  const spendCategoriesArray = Array.from(statementData.spendBuckets.entries())
    .map(([name, total]) => ({ name, total: roundCurrency(total) || 0 }))
    .filter((entry) => entry.total !== 0)
    .sort((a, b) => b.total - a.total);

  const spendTotal = roundCurrency(statementData.spendTotal) || 0;
  const essentialsTotal = spendCategoriesArray
    .filter((entry) => ESSENTIAL_CATEGORY_NAMES.has(entry.name))
    .reduce((acc, entry) => acc + entry.total, 0);

  const essentialsPct = spendTotal ? roundCurrency((essentialsTotal / spendTotal) * 100) : 0;
  const discretionPct = spendTotal ? roundCurrency(100 - essentialsPct) : 0;

  const savingsRatePct = incomeTotal ? roundCurrency(((incomeTotal - spendTotal) / incomeTotal) * 100) : null;
  const netCashflow = roundCurrency(incomeTotal - spendTotal) || 0;

  const snapshot = {
    userId: userObjectId,
    period: {
      month,
      start: range.start.toDate(),
      end: range.end.toDate(),
    },
    metrics: {
      income: {
        total: incomeTotal,
        bySource: incomeSourcesArray,
      },
      spend: {
        total: spendTotal,
        byCategory: spendCategoriesArray,
        essentialsPct,
        discretionPct,
      },
      savingsRatePct,
      cashflow: {
        net: netCashflow,
        trend3m: null,
        trend6m: null,
      },
      taxes: payslipData.taxes,
      balances: {
        opening: statementData.openingBalance,
        closing: statementData.closingBalance,
      },
      anomalies: statementData.anomalies,
    },
  };

  const previousSnapshots = await AnalyticsSnapshot.find({
    userId: userObjectId,
    'period.month': { $lt: month },
  })
    .sort({ 'period.month': -1 })
    .limit(6)
    .lean()
    .exec();

  const previousNets = previousSnapshots
    .map((doc) => doc?.metrics?.cashflow?.net)
    .filter((val) => typeof val === 'number' && Number.isFinite(val));

  if (previousNets.length >= 3) {
    const avg = previousNets.slice(0, 3).reduce((acc, val) => acc + val, 0) / 3;
    snapshot.metrics.cashflow.trend3m = roundCurrency(netCashflow - avg);
  }
  if (previousNets.length >= 6) {
    const avg = previousNets.slice(0, 6).reduce((acc, val) => acc + val, 0) / 6;
    snapshot.metrics.cashflow.trend6m = roundCurrency(netCashflow - avg);
  }

  return snapshot;
}

async function recomputeSnapshot(userId, month) {
  const snapshotDoc = await computeSnapshotDocument(userId, month);
  const result = await AnalyticsSnapshot.findOneAndUpdate(
    { userId: snapshotDoc.userId, 'period.month': month },
    { $set: snapshotDoc },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  )
    .lean()
    .exec();
  return result;
}

async function getOrCreateSnapshot(userId, month) {
  assertValidMonth(month);
  const userObjectId = normaliseUserId(userId);
  const existing = await AnalyticsSnapshot.findOne({ userId: userObjectId, 'period.month': month })
    .lean()
    .exec();
  if (existing) return existing;
  return recomputeSnapshot(userObjectId, month);
}

function parseRange(range) {
  if (!range) return 6;
  const match = String(range).trim().match(/^(\d+)([my])$/i);
  if (!match) return 6;
  const count = Number(match[1]);
  if (!Number.isFinite(count) || count <= 0) return 6;
  const unit = match[2].toLowerCase();
  if (unit === 'y') return count * 12;
  return count;
}

function buildMonthList(monthsBack, anchor = dayjs.utc()) {
  const list = [];
  for (let i = monthsBack - 1; i >= 0; i -= 1) {
    list.push(anchor.subtract(i, 'month').format('YYYY-MM'));
  }
  return list;
}

async function getSeries(userId, range = '6m') {
  const monthsBack = parseRange(range);
  const months = buildMonthList(monthsBack);

  const income = [];
  const spend = [];
  const net = [];
  const taxes = [];

  for (const month of months) {
    // eslint-disable-next-line no-await-in-loop
    const snapshot = await getOrCreateSnapshot(userId, month);
    const metrics = snapshot?.metrics || {};
    income.push({ month, total: roundCurrency(metrics.income?.total ?? 0) || 0 });
    spend.push({ month, total: roundCurrency(metrics.spend?.total ?? 0) || 0 });
    net.push({ month, total: roundCurrency(metrics.cashflow?.net ?? 0) || 0 });
    taxes.push({
      month,
      incomeTaxYTD: roundCurrency(metrics.taxes?.incomeTaxYTD ?? 0) || 0,
      niYTD: roundCurrency(metrics.taxes?.niYTD ?? 0) || 0,
      studentLoanYTD: roundCurrency(metrics.taxes?.studentLoanYTD ?? 0) || 0,
      pensionYTD: roundCurrency(metrics.taxes?.pensionYTD ?? 0) || 0,
    });
  }

  return {
    range: `${monthsBack}m`,
    months,
    income,
    spend,
    net,
    taxes,
  };
}

function scheduleRecompute(userId, month) {
  try {
    assertValidMonth(month);
  } catch (err) {
    return;
  }
  const key = `${userId}:${month}`;
  if (pendingRecomputes.has(key)) return;
  const timer = setTimeout(async () => {
    pendingRecomputes.delete(key);
    try {
      await recomputeSnapshot(userId, month);
    } catch (err) {
      console.warn('Failed to recompute snapshot from change stream', err);
    }
  }, 200);
  pendingRecomputes.set(key, timer);
}

function monthsFromRecord(doc) {
  if (!doc || !doc.normalized) return [];
  if (doc.type === 'payslip') {
    const month = parseMonthFromDate(doc.normalized?.payDate) || parseMonthFromDate(doc.normalized?.period?.end);
    return month ? [month] : [];
  }
  if (doc.type === 'bankStatement') {
    const period = doc.normalized?.period || {};
    const months = monthsBetween(period.start, period.end);
    if (months.length) return months;
    const month = parseMonthFromDate(period.start) || parseMonthFromDate(period.end);
    return month ? [month] : [];
  }
  return [];
}

function startChangeStream() {
  if (changeStream) return;
  if (!connection?.readyState) return;
  try {
    changeStream = Record.collection.watch(
      [
        {
          $match: {
            operationType: { $in: ['insert', 'update', 'replace'] },
          },
        },
      ],
      { fullDocument: 'updateLookup' }
    );
    changeStream.on('change', (event) => {
      const doc = event.fullDocument;
      if (!doc) return;
      const userId = doc.userId;
      const months = monthsFromRecord(doc);
      months.forEach((month) => scheduleRecompute(userId, month));
    });
    changeStream.on('error', (err) => {
      console.warn('Analytics change stream error', err);
      if (changeStream) {
        changeStream.close().catch(() => {});
        changeStream = null;
      }
      setTimeout(startChangeStream, 1000 * 30);
    });
  } catch (err) {
    console.warn('Unable to start analytics change stream', err);
  }
}

async function recomputeRecentMonths(monthsBack = 6) {
  const distinctUsers = await Record.distinct('userId').exec();
  const months = buildMonthList(monthsBack);
  for (const userId of distinctUsers) {
    for (const month of months) {
      // eslint-disable-next-line no-await-in-loop
      await recomputeSnapshot(userId, month).catch((err) => {
        console.warn('Failed nightly recompute', { userId, month, err });
      });
    }
  }
}

function scheduleNightlyRecompute() {
  const run = async () => {
    try {
      await recomputeRecentMonths(6);
    } catch (err) {
      console.warn('Nightly analytics recompute failed', err);
    } finally {
      schedule();
    }
  };

  const schedule = () => {
    const now = dayjs.utc();
    let next = now.hour(2).minute(0).second(0).millisecond(0);
    if (!next.isAfter(now)) {
      next = next.add(1, 'day');
    }
    const delay = next.diff(now, 'millisecond');
    const safeDelay = Number.isFinite(delay) && delay > 0 ? delay : dayjs.duration({ hours: 24 }).asMilliseconds();
    setTimeout(run, safeDelay);
  };

  schedule();
}

function startAnalyticsEngine() {
  if (engineStarted) return;
  engineStarted = true;
  if (process.env.ANALYTICS_ENGINE_DISABLED === '1') return;
  startChangeStream();
  scheduleNightlyRecompute();
}

module.exports = {
  startAnalyticsEngine,
  getOrCreateSnapshot,
  recomputeSnapshot,
  getSeries,
  computeSnapshotDocument,
  scheduleNightlyRecompute,
};
