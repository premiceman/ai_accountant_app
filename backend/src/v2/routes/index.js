const express = require('express');
const meRouter = require('./me');

function buildRouter() {
  const router = express.Router();
  router.use('/me', meRouter);
  return router;
}

module.exports = { buildRouter };
