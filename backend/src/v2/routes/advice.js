const express = require('express');
const { generateAdvice, listAdvice } = require('../services/advice');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const items = await listAdvice(req.user.id);
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

router.post('/rebuild', async (req, res, next) => {
  try {
    const items = await generateAdvice(req.user.id);
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
