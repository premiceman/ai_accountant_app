// NOTE: Hotfix — TS types for shared flags + FE v1 flip + staged loader + prefer-v1 legacy; aligns with Phase-1/2/3 specs. Additive, non-breaking.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const originalLoad = Module._load;
Module._load = function patchedLoader(request, parent, isMain) {
  if (request === 'pino') {
    return () => ({ info() {}, warn() {}, error() {}, debug() {} });
  }
  if (request === 'express') {
    const expressMock = () => ({ use() {}, get() {}, post() {} });
    expressMock.Router = () => ({ use() {}, get() {}, post() {} });
    return expressMock;
  }
  if (request === 'mongoose') {
    class ObjectId {
      constructor(value) {
        this.value = value;
      }
      toString() {
        return String(this.value);
      }
    }
    ObjectId.isValid = () => true;

    class Schema {
      constructor() {}
      index() {}
    }
    Schema.Types = { ObjectId };

    return {
      Schema,
      model: () => ({ find: () => ({ lean: () => ({ exec: async () => [] }) }) }),
      Types: { ObjectId },
      connection: { readyState: 0, once() {} },
    };
  }
  if (request === 'jsonwebtoken') {
    return { verify: () => ({ id: 'stub-user' }), sign: () => 'token' };
  }
  if (request === 'dayjs') {
    const stub = () => ({
      isValid: () => true,
      startOf: () => ({ ...stub(), toDate: () => new Date() }),
      endOf: () => ({ ...stub(), toDate: () => new Date() }),
      toDate: () => new Date(),
      isAfter: () => false,
      isBefore: () => false,
      diff: () => 0,
      add: () => stub(),
      subtract: () => stub(),
      month: () => 0,
      year: () => 0,
      format: () => '1970-01-01',
    });
    return stub;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const router = require('../routes/analytics');
Module._load = originalLoad;

test('legacy analytics normalises sources with preferV1 data', () => {
  const sources = {
    statement1: {
      baseKey: 'current_account_statement',
      catalogueKey: 'current_account_statement',
      transactionsV1: [
        {
          amountMinor: -12345,
          direction: 'outflow',
          category: 'Groceries',
          description: 'Groceries Store',
          date: '2024-05-01',
          accountId: 'acc-1',
          accountName: 'Primary Account',
        },
        {
          amountMinor: 55500,
          direction: 'inflow',
          category: 'Income',
          description: 'Salary',
          date: '2024-05-02',
          accountId: 'acc-1',
          accountName: 'Primary Account',
        },
      ],
      metricsV1: {
        period: { start: '2024-05-01', end: '2024-05-31', month: '2024-05' },
        inflowsMinor: 55500,
        outflowsMinor: 12345,
        netMinor: 43155,
      },
    },
    payslip1: {
      baseKey: 'payslip',
      catalogueKey: 'payslip',
      metricsV1: {
        payDate: '2024-05-25',
        period: { start: '2024-05-01', end: '2024-05-31', month: '2024-05' },
        employer: 'ExampleCo',
        grossMinor: 100000,
        netMinor: 70000,
        taxMinor: 20000,
        nationalInsuranceMinor: 10000,
        pensionMinor: 0,
        studentLoanMinor: 0,
        taxCode: '1250L',
      },
    },
  };

  const normalised = router.__test.normaliseSourcesWithPreferred(sources);

  const statement = normalised.statement1;
  assert.ok(statement, 'statement entry present');
  assert.ok(Array.isArray(statement.transactions), 'transactions array normalised');
  const [firstTx] = statement.transactions;
  assert.equal(firstTx.amount, -123.45, 'transaction amount converted to major units');
  assert.equal(firstTx.category, 'Groceries', 'category preserved');
  assert.equal(statement.metrics?.totals?.spend, 123.45, 'statement spend uses v1 metrics');

  const payslip = normalised.payslip1;
  assert.ok(payslip, 'payslip entry present');
  assert.equal(payslip.metrics?.gross, 1000, 'gross pay converted from minor units');
  assert.equal(payslip.metrics?.net, 700, 'net pay converted from minor units');
  assert.equal(payslip.metrics?.payDate, '2024-05-25', 'pay date sourced from v1 metrics');
});
