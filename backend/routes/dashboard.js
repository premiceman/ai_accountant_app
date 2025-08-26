// backend/routes/dashboard.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const mongoose = require('mongoose');

/**
 * Tries to read the latest financial snapshot for the user from a generic
 * collection: "financial_snapshots". If none found, returns safe defaults.
 *
 * Expected snapshot shape (example):
 * {
 *   userId: <ObjectId/String>,
 *   currency: 'GBP',
 *   asOf: ISODate,
 *   assets: Number,
 *   liabilities: Number,
 *   debts: Number,
 *   savings: Number,
 *   expensesLastMonth: Number,
 *   incomesLastMonth: Number,
 *   netWorth: Number,              // optional (computed if missing)
 *   history: [{ month:'2025-07', value: 12000 }, ...]  // optional series
 * }
 */
router.get('/summary', auth, async (req, res) => {
  try {
    const db = mongoose.connection?.db;
    let snap = null;

    if (db) {
      const col = db.collection('financial_snapshots');
      snap = await col.findOne(
        { userId: String(req.user.id) },
        { sort: { asOf: -1 } }
      );
    }

    const currency = snap?.currency || 'GBP';
    const assets = Number(snap?.assets ?? 0);
    const liabilities = Number(snap?.liabilities ?? 0);
    const debts = Number(snap?.debts ?? 0);
    const savings = Number(snap?.savings ?? 0);
    const expensesLastMonth = Number(snap?.expensesLastMonth ?? 0);
    const incomesLastMonth = Number(snap?.incomesLastMonth ?? 0);
    const netWorthComputed = assets - liabilities;
    const netWorth = Number(snap?.netWorth ?? netWorthComputed);

    // Delta from last month if we have at least 2 points in history
    let deltaMoMPercent = null;
    const series = Array.isArray(snap?.history) ? snap.history : [];
    if (series.length >= 2) {
      const last = series[series.length - 1].value;
      const prev = series[series.length - 2].value;
      if (typeof last === 'number' && typeof prev === 'number' && prev !== 0) {
        deltaMoMPercent = ((last - prev) / Math.abs(prev)) * 100;
      }
    }

    const missingIntegrations = {
      truelayer: Boolean(snap?.truelayerConnected === false) || !snap?.truelayerConnected,
    };

    return res.json({
      summary: {
        currency,
        asOf: snap?.asOf || new Date().toISOString(),
        netWorth,
        deltaMoMPercent,
        assets,
        liabilities,
        debts,
        savings,
        expensesLastMonth,
        incomesLastMonth,
      },
      series: { netWorth: series },
      missingIntegrations,
    });
  } catch (e) {
    console.error('GET /api/dashboard/summary error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
