const express = require('express');
const meRouter = require('./me');
const vaultRouter = require('./vault');
const analyticsRouter = require('./analytics');
const adviceRouter = require('./advice');
const taxRouter = require('./tax');
const adminRouter = require('./admin');

function buildRouter() {
  const router = express.Router();
  router.use('/me', meRouter);
  router.use('/vault', vaultRouter);
  router.use('/analytics', analyticsRouter);
  router.use('/advice', adviceRouter);
  router.use('/tax', taxRouter);
  router.use('/admin', adminRouter);
  return router;
}

module.exports = { buildRouter };
