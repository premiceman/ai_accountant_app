// NOTE: QA Harness for Phase-3 — validates /api/analytics/v1, flags, caching, staged loader "failed". Non-breaking.
'use strict';

const canonicalCategories = Object.freeze(require('../canonicalCategories.json'));

const ISO_DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';

const dashboardSummaryV1 = Object.freeze({
  $id: 'shared/schemas/analytics/dashboardSummaryV1.json',
  type: 'object',
  additionalProperties: false,
  required: ['period', 'totals', 'version'],
  properties: {
    period: {
      type: 'object',
      additionalProperties: false,
      required: ['start', 'end', 'granularity'],
      properties: {
        start: { type: 'string', pattern: ISO_DATE_PATTERN },
        end: { type: 'string', pattern: ISO_DATE_PATTERN },
        granularity: { type: 'string', enum: ['month', 'quarter', 'year'] },
      },
    },
    totals: {
      type: 'object',
      additionalProperties: false,
      required: ['incomeMinor', 'spendMinor', 'netMinor'],
      properties: {
        incomeMinor: { type: 'integer', minimum: 0 },
        spendMinor: { type: 'integer', minimum: 0 },
        netMinor: { type: 'integer' },
      },
    },
    version: { type: 'string', enum: ['v1'] },
  },
});

const categoriesV1 = Object.freeze({
  $id: 'shared/schemas/analytics/categoriesV1.json',
  type: 'object',
  additionalProperties: false,
  required: ['period', 'categories', 'version'],
  properties: {
    period: {
      type: 'object',
      additionalProperties: false,
      required: ['start', 'end'],
      properties: {
        start: { type: 'string', pattern: ISO_DATE_PATTERN },
        end: { type: 'string', pattern: ISO_DATE_PATTERN },
      },
    },
    categories: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'outflowMinor'],
        properties: {
          category: { type: 'string', enum: canonicalCategories },
          outflowMinor: { type: 'integer', minimum: 0 },
          inflowMinor: { type: 'integer', minimum: 0 },
        },
      },
    },
    version: { type: 'string', enum: ['v1'] },
  },
});

const largestExpensesV1 = Object.freeze({
  $id: 'shared/schemas/analytics/largestExpensesV1.json',
  type: 'object',
  additionalProperties: false,
  required: ['period', 'items', 'version'],
  properties: {
    period: {
      type: 'object',
      additionalProperties: false,
      required: ['start', 'end'],
      properties: {
        start: { type: 'string', pattern: ISO_DATE_PATTERN },
        end: { type: 'string', pattern: ISO_DATE_PATTERN },
      },
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['date', 'description', 'amountMinor', 'category'],
        properties: {
          date: { type: 'string', pattern: ISO_DATE_PATTERN },
          description: { type: 'string' },
          amountMinor: { type: 'integer', minimum: 0 },
          category: { type: 'string', enum: canonicalCategories },
          accountId: { type: ['string', 'null'] },
        },
      },
    },
    version: { type: 'string', enum: ['v1'] },
  },
});

const accountsV1 = Object.freeze({
  $id: 'shared/schemas/analytics/accountsV1.json',
  type: 'object',
  additionalProperties: false,
  required: ['period', 'accounts', 'version'],
  properties: {
    period: {
      type: 'object',
      additionalProperties: false,
      required: ['start', 'end'],
      properties: {
        start: { type: 'string', pattern: ISO_DATE_PATTERN },
        end: { type: 'string', pattern: ISO_DATE_PATTERN },
      },
    },
    accounts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['accountId', 'incomeMinor', 'spendMinor'],
        properties: {
          accountId: { type: 'string' },
          name: { type: ['string', 'null'] },
          incomeMinor: { type: 'integer', minimum: 0 },
          spendMinor: { type: 'integer', minimum: 0 },
        },
      },
    },
    version: { type: 'string', enum: ['v1'] },
  },
});

const timeseriesV1 = Object.freeze({
  $id: 'shared/schemas/analytics/timeseriesV1.json',
  type: 'object',
  additionalProperties: false,
  required: ['metric', 'granularity', 'series', 'paydayEvents', 'version'],
  properties: {
    metric: { type: 'string', enum: ['income', 'spend', 'net'] },
    granularity: { type: 'string', enum: ['day', 'week', 'month'] },
    series: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ts', 'valueMinor'],
        properties: {
          ts: { type: 'string', pattern: '^\\d{4}-\\d{2}(-\\d{2})?$' },
          valueMinor: { type: 'integer' },
        },
      },
    },
    paydayEvents: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ts', 'amountMinor'],
        properties: {
          ts: { type: 'string', pattern: ISO_DATE_PATTERN },
          amountMinor: { type: 'integer', minimum: 0 },
          employer: { type: ['string', 'null'] },
        },
      },
    },
    version: { type: 'string', enum: ['v1'] },
  },
});

module.exports = {
  canonicalCategories,
  dashboardSummaryV1,
  categoriesV1,
  largestExpensesV1,
  accountsV1,
  timeseriesV1,
};
