/**
 * ## Intent (Phase-1 only — additive, no breaking changes)
 *
 * Fix inconsistent dashboards by introducing a tiny, normalised v1 data layer alongside
 * today’s legacy fields. Worker dual-writes new normalised shapes, analytics prefers v1 with
 * legacy fallbacks, and Ajv validators warn without breaking existing flows.
 */

import assert from 'node:assert/strict';
import { Types } from 'mongoose';

import { enrichPayloadWithV1 } from '../documentJobLoop.js';
import { rebuildMonthlyAnalytics } from '../services/analytics.js';
import {
  DocumentInsightModel,
  UserAnalyticsModel,
  UserOverrideModel,
  type DocumentInsight,
} from '../models/index.js';

function buildBasePayload(overrides: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    userId: new Types.ObjectId(),
    fileId: 'file-base',
    catalogueKey: 'payslip',
    baseKey: 'payslip',
    schemaVersion: '1',
    parserVersion: '1',
    promptVersion: '1',
    model: 'gpt',
    extractionSource: 'heuristic',
    confidence: 1,
    contentHash: 'hash',
    documentDate: new Date('2024-04-30T00:00:00.000Z'),
    documentMonth: '2024-04',
    documentLabel: null,
    documentName: null,
    nameMatchesUser: null,
    collectionId: null,
    metadata: {},
    metrics: {},
    transactions: [],
    narrative: [],
    extractedAt: new Date('2024-04-30T00:00:00.000Z'),
    createdAt: new Date('2024-04-30T00:00:00.000Z'),
    updatedAt: new Date('2024-04-30T00:00:00.000Z'),
    version: null,
    currency: null,
    documentDateV1: null,
    metricsV1: null,
    transactionsV1: null,
    ...overrides,
  };
}

async function run(): Promise<void> {
  const userId = new Types.ObjectId();

  const payslipClassification = {
    type: 'payslip' as const,
    confidence: 0.9,
    employerName: 'Acme Corp',
    institutionName: null,
  };

  const payslipPayload = await enrichPayloadWithV1(
    buildBasePayload({
      userId,
      fileId: 'file-pay',
      metrics: {
        gross: 2500,
        net: 2000,
        tax: 300,
        ni: 150,
        pension: 100,
        studentLoan: 50,
      },
      metadata: {
        employerName: 'Acme Corp',
        period: { start: '2024-04-01', end: '2024-04-30', month: '2024-04' },
        totals: {
          grossPeriod: 2500,
          netPeriod: 2000,
        },
        earnings: [
          { rawLabel: 'Base salary', category: 'base_salary', amountPeriod: 2500 },
        ],
        deductions: [
          { rawLabel: 'Income Tax', category: 'income_tax', amountPeriod: 300 },
          { rawLabel: 'National Insurance', category: 'national_insurance', amountPeriod: 150 },
          { rawLabel: 'Pension Contribution', category: 'pension_employee', amountPeriod: 100 },
          { rawLabel: 'Student Loan', category: 'student_loan', amountPeriod: 50 },
        ],
      },
    }) as any,
    payslipClassification
  );

  assert.equal(payslipPayload.version, 'v1');
  assert.ok(payslipPayload.metricsV1);
  assert.equal(payslipPayload.currency, 'GBP');

  const statementClassification = {
    type: 'current_account_statement' as const,
    confidence: 0.8,
    employerName: null,
    institutionName: 'HSBC',
  };

  const statementPayload = await enrichPayloadWithV1(
    buildBasePayload({
      userId,
      fileId: 'file-statement',
      catalogueKey: 'current_account_statement',
      baseKey: 'current_account_statement',
      metadata: {
        period: { start: '2024-04-01', end: '2024-04-30', month: '2024-04' },
        accountId: 'acc-1',
        accountName: 'Main Current',
      },
      metrics: {
        openingBalance: 0,
        closingBalance: 1000,
        inflows: 2000,
        outflows: 150,
      },
      transactions: [
        {
          id: 'st-1',
          date: '2024-04-02',
          description: 'Salary payment',
          amount: 2000,
          direction: 'inflow',
          category: 'Income',
        },
        {
          id: 'st-2',
          date: '2024-04-05',
          description: 'Tesco Groceries',
          amount: -150,
          direction: 'outflow',
          category: 'Groceries',
        },
      ],
    }) as any,
    statementClassification
  );

  assert.equal(statementPayload.version, 'v1');
  assert.ok(Array.isArray(statementPayload.transactionsV1));
  assert.equal(statementPayload.transactionsV1?.length, 2);

  const payslipInsight = {
    _id: new Types.ObjectId(),
    ...payslipPayload,
    userId,
  } as unknown as DocumentInsight;

  const statementInsight = {
    _id: new Types.ObjectId(),
    ...statementPayload,
    userId,
  } as unknown as DocumentInsight;

  const originalFind = DocumentInsightModel.find;
  const originalOverridesFind = UserOverrideModel.find;
  const originalAnalyticsUpdate = UserAnalyticsModel.findOneAndUpdate;

  let capturedAnalytics: any = null;

  (DocumentInsightModel.find as any) = () => ({
    lean: () => ({
      exec: async () => [payslipInsight, statementInsight],
    }),
  });

  (UserOverrideModel.find as any) = () => ({
    lean: () => ({
      exec: async () => [],
    }),
  });

  (UserAnalyticsModel.findOneAndUpdate as any) = (_filter: unknown, update: any) => ({
    exec: async () => {
      capturedAnalytics = update.$set;
      return null;
    },
  });

  try {
    await rebuildMonthlyAnalytics({ userId, month: '2024-04' });
    assert.ok(capturedAnalytics, 'expected analytics document to be written');
    assert.equal(capturedAnalytics.income.gross, 2500);
    assert.equal(capturedAnalytics.income.net, 2000);
    assert.equal(capturedAnalytics.income.other, 2000);
    assert.equal(capturedAnalytics.spend.total, 150);
    assert.equal(capturedAnalytics.cashflow.net, 1850);
    const topCategories = capturedAnalytics.spend.byCategory.map((entry: any) => entry.category);
    assert.ok(topCategories.includes('Groceries'));
    console.log('V1 dashboard smoke test passed');
  } catch (error) {
    console.error('V1 dashboard smoke test failed', error);
    process.exitCode = 1;
  } finally {
    (DocumentInsightModel.find as any) = originalFind;
    (UserOverrideModel.find as any) = originalOverridesFind;
    (UserAnalyticsModel.findOneAndUpdate as any) = originalAnalyticsUpdate;
  }
}

run().catch((error) => {
  console.error('V1 dashboard smoke test encountered an unexpected error', error);
  process.exitCode = 1;
});
