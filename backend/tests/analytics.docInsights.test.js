const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const capturedRoutes = [];
const mockUserDoc = {
  _id: 'user-1',
  documentInsights: {
    sources: {
      payslipMay: {
        baseKey: 'payslip',
        catalogueKey: 'payslip',
        metrics: {
          gross: 4000,
          net: 3200,
          tax: 500,
          nationalInsurance: 200,
          totalDeductions: 800,
          earnings: [
            { label: 'Basic', amount: 3000 },
            { label: 'Bonus', amount: 1000 },
          ],
          deductions: [
            { label: 'Tax', amount: 500 },
            { label: 'NI', amount: 200 },
            { label: 'Other', amount: 100 },
          ],
          payDate: '2024-05-31',
        },
        metadata: {
          period: {
            month: '2024-05',
          },
        },
      },
      statementMay: {
        baseKey: 'current_account_statement',
        catalogueKey: 'current_account_statement',
        metadata: {
          period: {
            Date: '05/2024',
          },
        },
        transactions: [
          { description: 'Salary', amount: 1500, direction: 'inflow', date: '2024-05-05' },
          { description: 'Rent', amount: 600, direction: 'outflow', date: '2024-05-06' },
          { description: 'Groceries', amount: 200, direction: 'outflow', date: '2024-05-10' },
        ],
      },
    },
  },
};

const originalLoad = Module._load;

Module._load = function patchedLoader(request, parent, isMain) {
  if (request === 'pino') {
    return () => ({ info() {}, warn() {}, error() {}, debug() {} });
  }
  if (request === 'express') {
    const expressMock = () => ({
      use() {},
    });
    expressMock.Router = () => {
      const router = function routerStub() {};
      router.use = () => {};
      router.get = (path, ...handlers) => {
        capturedRoutes.push({ path, handlers });
      };
      router.post = () => {};
      router.__routes = capturedRoutes;
      return router;
    };
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
  if (request === '../middleware/auth') {
    return (req, res, next) => next();
  }
  if (request === '../models/User') {
    return {
      findById: () => ({
        lean: async () => mockUserDoc,
      }),
    };
  }
  if (request === '../models/DocumentInsight') {
    return {};
  }
  if (request === '../src/services/documents/insightsStore') {
    return { applyDocumentInsights() {}, setInsightsProcessing() {} };
  }
  if (request === '../src/services/vault/analytics') {
    return { rebuildMonthlyAnalytics() {} };
  }
  if (request === '../src/store/jsondb') {
    return { paths: {}, readJsonSafe: () => ({}) };
  }
  if (request === '../src/routes/analytics.v1.routes.js') {
    return null;
  }
  if (request === '../src/lib/featureFlags') {
    return { featureFlags: { enableAnalyticsLegacy: true } };
  }
  if (request === 'dayjs') {
    const pad = (value, length = 2) => String(value).padStart(length, '0');
    const cloneDate = (source) => new Date(source.getTime());
    const adjust = (date, value, unit) => {
      const next = cloneDate(date);
      switch (unit) {
        case 'month':
        case 'months':
          next.setUTCMonth(next.getUTCMonth() + value);
          break;
        case 'year':
        case 'years':
          next.setUTCFullYear(next.getUTCFullYear() + value);
          break;
        case 'day':
        case 'days':
          next.setUTCDate(next.getUTCDate() + value);
          break;
        default:
          break;
      }
      return next;
    };
    const startOf = (date, unit) => {
      const next = cloneDate(date);
      switch (unit) {
        case 'month':
          next.setUTCDate(1);
          next.setUTCHours(0, 0, 0, 0);
          break;
        case 'year':
          next.setUTCMonth(0, 1);
          next.setUTCHours(0, 0, 0, 0);
          break;
        case 'day':
          next.setUTCHours(0, 0, 0, 0);
          break;
        default:
          break;
      }
      return next;
    };
    const endOf = (date, unit) => {
      const next = startOf(date, unit);
      switch (unit) {
        case 'month':
          next.setUTCMonth(next.getUTCMonth() + 1);
          next.setUTCHours(0, 0, 0, 0);
          next.setUTCMilliseconds(next.getUTCMilliseconds() - 1);
          break;
        case 'year':
          next.setUTCFullYear(next.getUTCFullYear() + 1);
          next.setUTCHours(0, 0, 0, 0);
          next.setUTCMilliseconds(next.getUTCMilliseconds() - 1);
          break;
        case 'day':
          next.setUTCDate(next.getUTCDate() + 1);
          next.setUTCHours(0, 0, 0, 0);
          next.setUTCMilliseconds(next.getUTCMilliseconds() - 1);
          break;
        default:
          break;
      }
      return next;
    };
    const formatDate = (date, pattern) => {
      switch (pattern) {
        case 'MM/YYYY':
          return `${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
        case 'MMM YYYY':
          return date.toLocaleString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
        case 'D MMM YYYY':
          return date.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
        case 'YYYY':
          return String(date.getUTCFullYear());
        default:
          return date.toISOString();
      }
    };
    const wrapper = (input) => {
      let date;
      if (input instanceof Date) date = new Date(input.getTime());
      else if (input) date = new Date(input);
      else date = new Date();
      const valid = !Number.isNaN(date.valueOf());
      const api = {
        isValid: () => valid,
        format: (pattern) => (valid ? formatDate(date, pattern) : 'Invalid Date'),
        startOf: (unit) => wrapper(startOf(date, unit)),
        endOf: (unit) => wrapper(endOf(date, unit)),
        add: (value, unit) => wrapper(adjust(date, value, unit)),
        subtract: (value, unit) => wrapper(adjust(date, -value, unit)),
        toDate: () => new Date(date.getTime()),
        isAfter: (other) => date.getTime() > new Date(other).getTime(),
        isBefore: (other) => date.getTime() < new Date(other).getTime(),
        diff: () => 0,
        month: () => date.getUTCMonth(),
        year: () => date.getUTCFullYear(),
      };
      return api;
    };
    return wrapper;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const router = require('../routes/analytics');
Module._load = originalLoad;

const docInsightsRoute = capturedRoutes.find((route) => route.path === '/doc-insights');

const runAuth = (req, res, middleware) => new Promise((resolve, reject) => {
  try {
    const maybePromise = middleware(req, res, (err) => {
      if (err) reject(err);
      else resolve();
    });
    if (maybePromise && typeof maybePromise.then === 'function') {
      maybePromise.then(resolve).catch(reject);
    }
    if (!maybePromise) {
      // middleware already invoked next synchronously
    }
  } catch (error) {
    reject(error);
  }
});

test('GET /api/analytics/doc-insights returns simplified document metrics', async () => {
  assert.ok(docInsightsRoute, 'doc-insights route registered');
  const [authMiddleware, handler] = docInsightsRoute.handlers;
  const req = { user: { id: 'user-1' } };
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return payload;
    },
  };

  if (authMiddleware) {
    await runAuth(req, res, authMiddleware);
  }
  await handler(req, res);

  const payload = res.body;
  assert.ok(payload, 'response payload returned');
  assert.equal(payload.payslip.periodLabel, '05/2024');
  assert.equal(payload.payslip.totals.gross, 4000);
  assert.equal(payload.payslip.earnings.length, 2);
  assert.equal(payload.bankStatement.periodLabel, '05/2024');
  assert.equal(payload.bankStatement.moneyIn, 1500);
  assert.equal(payload.bankStatement.moneyOut, 800);
  assert.equal(payload.bankStatement.totals.net, 700);
  assert.equal(payload.bankStatement.transactions.length, 3);
});

