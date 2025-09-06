// backend/src/routes/summary.routes.js
const express = require('express');
const { buildSummary } = require('../services/summary.service');

const router = express.Router();

router.get('/current-year', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, max-age=0');

    const now = new Date();
    const { preset, start, end } = req.query;

    const rangeOpts = {};
    if (preset && ['last-month','last-quarter','last-year'].includes(preset)) {
      rangeOpts.preset = preset;
    } else if (start && end) {
      rangeOpts.start = start;
      rangeOpts.end = end;
    }

    const data = await buildSummary(now, rangeOpts);
    res.json(data);
  } catch (e) {
    console.error('summary error:', e);
    res.status(500).json({ error: 'Failed to build summary' });
  }
});

module.exports = router;
