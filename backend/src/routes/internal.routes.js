// backend/src/routes/internal.routes.js
const express = require('express');
const router = express.Router();

function isInternal(req) {
  const key = req.headers['x-internal-key'];
  return key && key === (process.env.INTERNAL_API_KEY || 'superlongrandomsecret');
}

router.post('/validate', (req, res) => {
  if (!isInternal(req)) return res.status(403).json({ error: 'Forbidden' });
  // TODO: implement document validation
  res.json({ ok: true, step: 'validate' });
});

router.post('/extract', (req, res) => {
  if (!isInternal(req)) return res.status(403).json({ error: 'Forbidden' });
  // TODO: implement extraction
  res.json({ ok: true, step: 'extract' });
});

router.post('/analytics', (req, res) => {
  if (!isInternal(req)) return res.status(403).json({ error: 'Forbidden' });
  // TODO: implement analytics
  res.json({ ok: true, step: 'analytics' });
});

module.exports = router;
