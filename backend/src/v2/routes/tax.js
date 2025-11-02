const express = require('express');
const AnalyticsSnapshotV2 = require('../models/AnalyticsSnapshotV2');

const router = express.Router();

router.get('/snapshot', async (req, res, next) => {
  try {
    const { taxYear } = req.query;
    if (!taxYear) {
      return res.status(400).json({ error: 'taxYear query required' });
    }
    const snapshot = await AnalyticsSnapshotV2.findOne({ userId: req.user.id, periodType: 'taxYear', periodValue: taxYear }).lean();
    if (!snapshot) {
      return res.status(404).json({ error: 'Snapshot not found' });
    }
    res.json({ snapshot });
  } catch (error) {
    next(error);
  }
});

router.post('/bundle', async (req, res, next) => {
  try {
    const snapshots = await AnalyticsSnapshotV2.find({ userId: req.user.id, periodType: 'taxYear' }).sort({ periodValue: 1 }).lean();
    res.json({ snapshots });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
