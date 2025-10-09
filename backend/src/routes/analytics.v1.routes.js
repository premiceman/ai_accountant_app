// NOTE: Phase-3 — Frontend uses /api/analytics/v1, staged loader on dashboards, Ajv strict. Rollback via flags.
// NOTE: Phase-2 — backfill v1 & add /api/analytics/v1/* endpoints. Legacy endpoints unchanged.
'use strict';

const express = require('express');
const mongoose = require('mongoose');
const pino = require('pino');
const auth = require('../../middleware/auth');
const DocumentInsight = require('../../models/DocumentInsight');
const { featureFlags } = require('../lib/featureFlags');
const { SimpleCache } = require('../lib/simpleCache');
const {
  aggregateSummary,
  aggregateCategories,
  aggregateLargestExpenses,
  aggregateAccounts,
  aggregateTimeseries,
} = require('../lib/analyticsV1');
const { normaliseRange, buildPeriod } = require('../lib/dateRange');

const cache = new SimpleCache({ ttlSeconds: featureFlags.analyticsCacheTtlSeconds });
const logger = pino({ name: 'analytics-v1-http', level: process.env.LOG_LEVEL ?? 'info' });

const router = express.Router();

router.use(auth);

function buildCacheKey(userId, path, query) {
  const parts = [userId, path];
  const keys = Object.keys(query).sort();
  keys.forEach((key) => parts.push(`${key}=${query[key]}`));
  return parts.join('|');
}

async function loadInsights(userId, range) {
  const objectId = mongoose.Types.ObjectId.isValid(userId)
    ? new mongoose.Types.ObjectId(userId)
    : userId;
  const match = {
    userId: objectId,
    $or: [
      { documentDateV1: { $gte: range.start, $lte: range.end } },
      { documentDate: { $gte: new Date(range.start), $lte: new Date(`${range.end}T23:59:59.999Z`) } },
      { createdAt: { $gte: new Date(range.start), $lte: new Date(`${range.end}T23:59:59.999Z`) } },
    ],
  };
  return DocumentInsight.find(match).lean().exec();
}

async function withCache(req, res, next, metricName, handler) {
  const start = process.hrtime.bigint();
  try {
    const userId = req.user.id;
    const key = buildCacheKey(userId, req.path, req.query);
    const cached = cache.get(key);
    if (cached) {
      res.set('X-Analytics-V1-Cache', 'hit');
      const duration = Number(process.hrtime.bigint() - start) / 1e6;
      logger.debug({ metric: `analytics.v1.${metricName}.durationMs`, durationMs: duration, cache: 'hit' });
      return res.json(cached);
    }
    const payload = await handler();
    cache.set(key, payload);
    res.set('X-Analytics-V1-Cache', 'miss');
    const duration = Number(process.hrtime.bigint() - start) / 1e6;
    logger.info({ metric: `analytics.v1.${metricName}.durationMs`, durationMs: duration, cache: 'miss' });
    return res.json(payload);
  } catch (error) {
    if (error?.statusCode === 422 && error.details) {
      logger.warn({ metric: `analytics.v1.${metricName}.validation`, details: error.details }, 'Schema validation failed');
      return res.status(422).json(error.details);
    }
    const duration = Number(process.hrtime.bigint() - start) / 1e6;
    logger.error({ metric: `analytics.v1.${metricName}.durationMs`, durationMs: duration, err: error }, 'analytics v1 handler failed');
    return next(error);
  }
}

router.get('/summary', async (req, res, next) => {
  if (!featureFlags.enableAnalyticsV1) return res.status(404).json({ error: 'Not found' });
  const { start, end, granularity = 'month' } = req.query;
  try {
    const range = normaliseRange({ start, end });
    return withCache(req, res, next, 'summary', async () => {
      const insights = await loadInsights(req.user.id, range);
      const result = aggregateSummary(insights, range);
      return {
        period: buildPeriod(range.start, range.end, granularity),
        totals: {
          incomeMinor: result.incomeMinor,
          spendMinor: result.spendMinor,
          netMinor: result.netMinor,
        },
        version: 'v1',
      };
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/categories', async (req, res, next) => {
  if (!featureFlags.enableAnalyticsV1) return res.status(404).json({ error: 'Not found' });
  const { start, end } = req.query;
  try {
    const range = normaliseRange({ start, end });
    return withCache(req, res, next, 'categories', async () => {
      const insights = await loadInsights(req.user.id, range);
      const summary = aggregateSummary(insights, range);
      return {
        period: { start: range.start, end: range.end },
        categories: aggregateCategories(summary.transactions),
        version: 'v1',
      };
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/largest-expenses', async (req, res, next) => {
  if (!featureFlags.enableAnalyticsV1) return res.status(404).json({ error: 'Not found' });
  const { start, end, limit = '10' } = req.query;
  try {
    const range = normaliseRange({ start, end });
    const max = Math.max(1, Number(limit) || 10);
    return withCache(req, res, next, 'largest-expenses', async () => {
      const insights = await loadInsights(req.user.id, range);
      const summary = aggregateSummary(insights, range);
      return {
        period: { start: range.start, end: range.end },
        items: aggregateLargestExpenses(summary.transactions, max),
        version: 'v1',
      };
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/accounts', async (req, res, next) => {
  if (!featureFlags.enableAnalyticsV1) return res.status(404).json({ error: 'Not found' });
  const { start, end } = req.query;
  try {
    const range = normaliseRange({ start, end });
    return withCache(req, res, next, 'accounts', async () => {
      const insights = await loadInsights(req.user.id, range);
      const summary = aggregateSummary(insights, range);
      return {
        period: { start: range.start, end: range.end },
        accounts: aggregateAccounts(summary.transactions),
        version: 'v1',
      };
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/timeseries', async (req, res, next) => {
  if (!featureFlags.enableAnalyticsV1) return res.status(404).json({ error: 'Not found' });
  const { start, end, metric = 'income', granularity = 'month' } = req.query;
  if (!['income', 'spend', 'net'].includes(metric)) {
    return res.status(400).json({ error: 'Invalid metric' });
  }
  if (!['day', 'week', 'month'].includes(granularity)) {
    return res.status(400).json({ error: 'Invalid granularity' });
  }
  try {
    const range = normaliseRange({ start, end });
    return withCache(req, res, next, 'timeseries', async () => {
      const insights = await loadInsights(req.user.id, range);
      const summary = aggregateSummary(insights, range);
      return {
        metric,
        granularity,
        series: aggregateTimeseries(summary.transactions, range, granularity, metric),
        paydayEvents: summary.payslips
          .filter((p) => p?.netMinor)
          .map((p) => ({ ts: p.payDate, amountMinor: p.netMinor, employer: p.employer ?? null })),
        version: 'v1',
      };
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
