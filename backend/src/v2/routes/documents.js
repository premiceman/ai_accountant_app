const express = require('express');
const { computeCompleteness } = require('../services/documents/completeness');

const router = express.Router();

router.get('/completeness', async (req, res, next) => {
  try {
    const month = typeof req.query.month === 'string' ? req.query.month : null;
    const result = await computeCompleteness({ userId: req.user.id, month });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
