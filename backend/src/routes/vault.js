let router;
try {
  router = require('./vault.routes');
} catch (err) {
  console.error('⚠️  Failed to load vault.routes:', err);
  try {
    const express = require('express');
    router = express.Router();
    router.all('*', (_req, res) => {
      res.status(503).json({ error: 'Vault service unavailable', details: err?.message || 'Failed to initialize vault router' });
    });
  } catch {
    router = (_req, _res, next) => next();
  }
}

module.exports = router;
