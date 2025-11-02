const dayjs = require('dayjs');
const AnalyticsSnapshotV2 = require('../models/AnalyticsSnapshotV2');
const TransactionV2 = require('../models/TransactionV2');
const PayslipMetricsV2 = require('../models/PayslipMetricsV2');
const DocumentInsight = require('../models/DocumentInsight');

function monthRange(month) {
  const start = dayjs(`${month}-01`);
  const end = start.endOf('month');
  return { start: start.format('YYYY-MM-DD'), end: end.format('YYYY-MM-DD') };
}

function taxYearRange(taxYear) {
  const [startYear, endPart] = taxYear.split('-');
  const start = dayjs(`${startYear}-04-06`);
  const endYear = Number(startYear.slice(0, 2) + endPart);
  const end = dayjs(`${endYear}-04-05`);
  return { start: start.format('YYYY-MM-DD'), end: end.format('YYYY-MM-DD') };
}

function collectSourceRefs(insights, fileIds) {
  const refs = [];
  const used = new Set();
  insights.forEach((insight) => {
    if (!fileIds.has(insight.fileId)) return;
    (insight.lineage || []).forEach((entry) => {
      const key = `${entry.provenance.fileId}:${entry.provenance.page}:${entry.provenance.anchor}`;
      if (used.has(key)) return;
      used.add(key);
      refs.push(entry.provenance);
    });
  });
  return refs;
}

async function computeMonthlySnapshot(userId, month) {
  const { start, end } = monthRange(month);
  const transactions = await TransactionV2.find({ userId, date: { $gte: start, $lte: end } }).lean();
  const payslips = await PayslipMetricsV2.find({ userId, 'payPeriod.paymentDate': { $gte: start, $lte: end } }).lean();
  const inflows = transactions.filter((tx) => tx.amount >= 0).reduce((sum, tx) => sum + tx.amount, 0);
  const outflows = transactions.filter((tx) => tx.amount < 0).reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
  const categoryTotals = {};
  transactions.forEach((tx) => {
    const key = tx.category || 'uncategorised';
    categoryTotals[key] = (categoryTotals[key] || 0) + (tx.amount < 0 ? Math.abs(tx.amount) : tx.amount);
  });
  const salaryNet = payslips.reduce((sum, slip) => sum + slip.netPay, 0);
  const salaryGross = payslips.reduce((sum, slip) => sum + slip.grossPay, 0);
  const fileIds = new Set([
    ...transactions.map((tx) => tx.fileId),
    ...payslips.map((slip) => slip.fileId),
  ]);
  const insights = await DocumentInsight.find({ userId, fileId: { $in: Array.from(fileIds) } }).lean();
  const sourceRefs = collectSourceRefs(insights, fileIds);

  return {
    periodType: 'month',
    periodValue: month,
    metrics: {
      totals: {
        inflows,
        outflows,
        netCash: inflows - outflows,
      },
      salary: {
        gross: salaryGross,
        net: salaryNet,
      },
      categories: categoryTotals,
    },
    sourceRefs,
  };
}

async function computeTaxYearSnapshot(userId, taxYear) {
  const { start, end } = taxYearRange(taxYear);
  const transactions = await TransactionV2.find({ userId, date: { $gte: start, $lte: end } }).lean();
  const payslips = await PayslipMetricsV2.find({ userId, 'payPeriod.paymentDate': { $gte: start, $lte: end } }).lean();
  const inflows = transactions.filter((tx) => tx.amount >= 0).reduce((sum, tx) => sum + tx.amount, 0);
  const outflows = transactions.filter((tx) => tx.amount < 0).reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
  const salaryNet = payslips.reduce((sum, slip) => sum + slip.netPay, 0);
  const salaryGross = payslips.reduce((sum, slip) => sum + slip.grossPay, 0);
  const fileIds = new Set([
    ...transactions.map((tx) => tx.fileId),
    ...payslips.map((slip) => slip.fileId),
  ]);
  const insights = await DocumentInsight.find({ userId, fileId: { $in: Array.from(fileIds) } }).lean();
  const sourceRefs = collectSourceRefs(insights, fileIds);

  return {
    periodType: 'taxYear',
    periodValue: taxYear,
    metrics: {
      totals: {
        inflows,
        outflows,
        netCash: inflows - outflows,
      },
      salary: {
        gross: salaryGross,
        net: salaryNet,
      },
    },
    sourceRefs,
  };
}

async function saveSnapshot(userId, snapshot) {
  await AnalyticsSnapshotV2.findOneAndUpdate(
    { userId, periodType: snapshot.periodType, periodValue: snapshot.periodValue },
    {
      userId,
      periodType: snapshot.periodType,
      periodValue: snapshot.periodValue,
      metrics: snapshot.metrics,
      sourceRefs: snapshot.sourceRefs,
      updatedAt: new Date(),
    },
    { upsert: true },
  );
}

async function recomputeSnapshotsForPeriods(userId, { months = [], taxYears = [] } = {}) {
  const uniqueMonths = Array.from(new Set(months.filter(Boolean)));
  const uniqueYears = Array.from(new Set(taxYears.filter(Boolean)));
  for (const month of uniqueMonths) {
    const snapshot = await computeMonthlySnapshot(userId, month);
    await saveSnapshot(userId, snapshot);
  }
  for (const year of uniqueYears) {
    const snapshot = await computeTaxYearSnapshot(userId, year);
    await saveSnapshot(userId, snapshot);
  }
}

async function getAnalyticsSummary(userId) {
  const recent = await AnalyticsSnapshotV2.find({ userId, periodType: 'month' }).sort({ periodValue: -1 }).limit(6).lean();
  const latest = recent[0] || null;
  return {
    latest,
    trend: recent.reverse(),
  };
}

async function getTimeseries(userId) {
  return AnalyticsSnapshotV2.find({ userId, periodType: 'month' }).sort({ periodValue: 1 }).lean();
}

async function getCategories(userId, month) {
  const snapshot = await AnalyticsSnapshotV2.findOne({ userId, periodType: 'month', periodValue: month }).lean();
  return snapshot?.metrics?.categories || {};
}

async function getCommitments(userId) {
  const txns = await TransactionV2.find({ userId }).lean();
  const recurring = {};
  txns.forEach((tx) => {
    if (tx.amount < 0) {
      const key = tx.description.toLowerCase();
      recurring[key] = (recurring[key] || 0) + Math.abs(tx.amount);
    }
  });
  return recurring;
}

module.exports = {
  recomputeSnapshotsForPeriods,
  getAnalyticsSummary,
  getTimeseries,
  getCategories,
  getCommitments,
};
