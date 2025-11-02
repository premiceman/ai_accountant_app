const express = require('express');
const { getAnalyticsSummary, getTimeseries, getCategories, getCommitments } = require('../services/analytics');

const router = express.Router();

router.get('/summary', async (req, res, next) => {
  try {
    const summary = await getAnalyticsSummary(req.user.id);
    res.json(summary);
  } catch (error) {
    next(error);
  }
});

router.get('/timeseries', async (req, res, next) => {
  try {
    const series = await getTimeseries(req.user.id);
    res.json({ series });
  } catch (error) {
    next(error);
  }
});

router.get('/categories', async (req, res, next) => {
  try {
    const { month } = req.query;
    const categories = await getCategories(req.user.id, month);
    res.json({ categories });
  } catch (error) {
    next(error);
  }
});

router.get('/commitments', async (req, res, next) => {
  try {
    const commitments = await getCommitments(req.user.id);
    res.json({ commitments });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
