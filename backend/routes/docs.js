// backend/routes/docs.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const mongoose = require('mongoose');

/**
 * Returns a list of required documents and whether each is uploaded.
 * Looks in generic "documents" collection for { userId, type, uploadedAt }.
 */
router.get('/requirements', auth, async (req, res) => {
  try {
    const required = [
      { key: 'proof_of_id',    label: 'Proof of ID (Passport/Driving License)' },
      { key: 'address_proof',  label: 'Proof of Address (Utility Bill)' },
      { key: 'bank_statements',label: 'Bank Statements (last 3 months)' },
      { key: 'p60',            label: 'P60 (latest)' },
      { key: 'p45',            label: 'P45 (if changed jobs)' },
      { key: 'invoices',       label: 'Invoices (if self-employed)' },
      { key: 'receipts',       label: 'Expense Receipts' },
      { key: 'vat_returns',    label: 'VAT Returns (if applicable)' },
    ];

    const db = mongoose.connection?.db;
    let uploaded = [];
    if (db) {
      const col = db.collection('documents');
      uploaded = await col
        .find({ userId: String(req.user.id), uploadedAt: { $exists: true } })
        .project({ type: 1, uploadedAt: 1, _id: 0 })
        .toArray();
    }

    const map = new Map(uploaded.map(d => [d.type, d.uploadedAt]));
    const response = required.map(r => ({
      key: r.key,
      label: r.label,
      status: map.has(r.key) ? 'uploaded' : 'missing',
      uploadedAt: map.get(r.key) || null,
    }));

    return res.json({ required: response });
  } catch (e) {
    console.error('GET /api/docs/requirements error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
