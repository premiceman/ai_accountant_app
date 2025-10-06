const express = require('express');

const auth = require('../../middleware/auth');

const router = express.Router();

router.use(auth);

router.all('*', (_req, res) => {
  res.status(410).json({
    error: 'The documents API has been replaced by the vault service.',
    next: {
      catalogue: '/api/vault/catalogue',
      collections: '/api/vault/collections',
    },
  });
});

module.exports = router;
