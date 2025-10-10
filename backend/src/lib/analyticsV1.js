'use strict';

const {
  STATEMENT_TYPES,
  preferV1,
  computeBackfillPatch,
} = require('./analytics/normalisers');
const {
  aggregateSummary,
  aggregateCategories,
  aggregateLargestExpenses,
  aggregateAccounts,
  aggregateTimeseries,
  mapTransactionsWithinRange,
} = require('./analytics/aggregators');

module.exports = {
  STATEMENT_TYPES,
  preferV1,
  computeBackfillPatch,
  aggregateSummary,
  aggregateCategories,
  aggregateLargestExpenses,
  aggregateAccounts,
  aggregateTimeseries,
  mapTransactionsWithinRange,
};
