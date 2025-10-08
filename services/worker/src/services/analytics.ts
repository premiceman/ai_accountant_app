import type { Types } from 'mongoose';
import {
  DocumentInsightModel,
  UserAnalyticsModel,
  UserOverrideModel,
  type DocumentInsight,
  type UserOverride,
} from '../models/index.js';

function groupByCategory(transactions: unknown[]): { totalOutflow: number; buckets: { category: string; outflow: number; share: number }[] } {
  const totals = new Map<string, number>();
  for (const tx of transactions) {
    if (!tx || typeof tx !== 'object') continue;
    const record = tx as Record<string, unknown>;
    if (record.direction !== 'outflow') continue;
    if ((record.category as string | undefined) === 'Transfers') continue;
    const amount = Math.abs(Number(record.amount) || 0);
    if (!amount) continue;
    const key = (record.category as string | undefined) || 'Misc';
    totals.set(key, (totals.get(key) || 0) + amount);
  }
  const totalOutflow = Array.from(totals.values()).reduce((acc, val) => acc + val, 0);
  return {
    totalOutflow,
    buckets: Array.from(totals.entries()).map(([category, outflow]) => ({
      category,
      outflow,
      share: totalOutflow ? outflow / totalOutflow : 0,
    })),
  };
}

function applyTransactionOverrides(transactions: unknown[], overrides: UserOverride[]): unknown[] {
  const patches = overrides.filter((ovr) => ovr.scope === 'transaction');
  if (!patches.length) return transactions;
  return transactions.map((tx) => {
    if (!tx || typeof tx !== 'object') return tx;
    const record = tx as Record<string, unknown>;
    const relevant = patches.filter((patch) => patch.targetId === record.id);
    if (!relevant.length) return tx;
    return relevant.reduce<Record<string, unknown>>((acc, patch) => Object.assign(acc, patch.patch as Record<string, unknown>), {
      ...record,
    });
  });
}

function applyMetricOverrides<T>(doc: T, overrides: UserOverride[]): T {
  const patches = overrides.filter((ovr) => ovr.scope === 'metric');
  if (!patches.length) return doc;
  const clone = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
  for (const patch of patches) {
    if (!patch.targetId) continue;
    const segments = String(patch.targetId).split('.');
    let cursor: Record<string, unknown> = clone;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const seg = segments[i];
      const value = cursor[seg];
      if (value == null || typeof value !== 'object') {
        cursor[seg] = {};
      }
      cursor = cursor[seg] as Record<string, unknown>;
    }
    cursor[segments[segments.length - 1]] = patch.patch as unknown;
  }
  return clone as T;
}

function assertValidMonth(month: string): void {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error(`Invalid period month ${month}`);
  }
  const parsed = new Date(`${month}-01T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid period month ${month}`);
  }
}

export async function rebuildMonthlyAnalytics({
  userId,
  month,
}: {
  userId: Types.ObjectId;
  month: string;
}): Promise<void> {
  assertValidMonth(month);

  const insights = await DocumentInsightModel.find({ userId, documentMonth: month }).lean<DocumentInsight[]>().exec();
  const overrides = await UserOverrideModel.find({ userId, appliesFrom: { $lte: `${month}-31` } }).lean<UserOverride[]>().exec();

  let incomeGross = 0;
  let incomeNet = 0;
  let incomeOther = 0;
  let spendTotal = 0;
  let cashIn = 0;
  let cashOut = 0;
  let hmrcWithheld = 0;
  let hmrcPaid = 0;

  const statementTransactions: unknown[] = [];

  const sources = {
    payslips: 0,
    statements: 0,
    savings: 0,
    isa: 0,
    investments: 0,
    hmrc: 0,
    pension: 0,
  };

  const savings = { balance: 0, interest: 0 };
  const investments = { balance: 0, contributions: 0, estReturn: 0 };
  const pension = { balance: 0, contributions: 0 };

  for (const insight of insights) {
    switch (insight.catalogueKey) {
      case 'payslip': {
        sources.payslips += 1;
        const metrics = (insight.metrics ?? {}) as Record<string, unknown>;
        incomeGross += Number(metrics.gross || 0);
        incomeNet += Number(metrics.net || 0);
        hmrcWithheld +=
          Number(metrics.tax || 0) + Number(metrics.ni || 0) + Number(metrics.studentLoan || 0);
        break;
      }
      case 'current_account_statement':
      case 'savings_account_statement':
      case 'isa_statement':
      case 'investment_statement':
      case 'pension_statement': {
        if (insight.catalogueKey === 'current_account_statement') sources.statements += 1;
        if (insight.catalogueKey === 'savings_account_statement') sources.savings += 1;
        if (insight.catalogueKey === 'isa_statement') sources.isa += 1;
        if (insight.catalogueKey === 'investment_statement') sources.investments += 1;
        if (insight.catalogueKey === 'pension_statement') sources.pension += 1;
        const txs = applyTransactionOverrides(insight.transactions ?? [], overrides);
        statementTransactions.push(...txs);
        const metrics = (insight.metrics ?? {}) as Record<string, unknown>;
        if (insight.catalogueKey === 'savings_account_statement') {
          savings.balance = Number(metrics.closingBalance || savings.balance);
          savings.interest += Number(metrics.interestOrDividends || 0);
        }
        if (insight.catalogueKey === 'isa_statement' || insight.catalogueKey === 'investment_statement') {
          investments.balance = Number(metrics.closingBalance || investments.balance);
          investments.contributions += Number(metrics.contributions || 0);
          if (metrics.estReturn != null) {
            investments.estReturn += Number(metrics.estReturn);
          }
        }
        if (insight.catalogueKey === 'pension_statement') {
          pension.balance = Number(metrics.closingBalance || pension.balance);
          pension.contributions += Number(metrics.contributions || 0);
        }
        break;
      }
      case 'hmrc_correspondence': {
        sources.hmrc += 1;
        const metrics = (insight.metrics ?? {}) as Record<string, unknown>;
        hmrcPaid += Number(metrics.taxPaid || 0);
        break;
      }
      default:
        break;
    }
  }

  if (statementTransactions.length) {
    for (const tx of statementTransactions) {
      if (!tx || typeof tx !== 'object') continue;
      const record = tx as Record<string, unknown>;
      const amount = Number(record.amount) || 0;
      const direction = record.direction as string | undefined;
      const description = (record.description as string | undefined) ?? '';
      const category = (record.category as string | undefined) ?? '';
      if (direction === 'inflow') {
        cashIn += amount;
        if (category.toLowerCase() === 'income') {
          incomeOther += amount;
        }
        if (/(hmrc|tax)/i.test(description)) {
          hmrcPaid += amount;
        }
      } else if (direction === 'outflow') {
        const abs = Math.abs(amount);
        cashOut += abs;
        if (category.toLowerCase() !== 'transfers') {
          spendTotal += abs;
        }
        if (/(hmrc|tax)/i.test(description)) {
          hmrcPaid += abs;
        }
      }
    }
  }

  const { totalOutflow, buckets } = groupByCategory(statementTransactions);
  if (!spendTotal) {
    spendTotal = totalOutflow;
  }

  const analyticsDoc = applyMetricOverrides(
    {
      userId,
      period: month,
      builtAt: new Date(),
      sources,
      income: {
        gross: incomeGross,
        net: incomeNet,
        other: incomeOther,
      },
      spend: {
        total: spendTotal,
        byCategory: buckets,
        largestExpenses: [],
      },
      cashflow: {
        inflows: cashIn,
        outflows: cashOut,
        net: cashIn - cashOut,
      },
      savings,
      investments,
      pension,
      tax: {
        withheld: hmrcWithheld,
        paidToHMRC: hmrcPaid,
        effectiveRate: incomeGross ? (hmrcWithheld + hmrcPaid) / incomeGross : 0,
      },
      derived: {
        savingsRate: incomeNet ? (incomeNet - spendTotal) / incomeNet : 0,
        topMerchants: [],
      },
    },
    overrides
  );

  await UserAnalyticsModel.findOneAndUpdate(
    { userId, period: month },
    { $set: analyticsDoc },
    { upsert: true, new: true }
  ).exec();
}
