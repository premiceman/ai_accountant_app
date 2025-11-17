const express = require('express');
const meRouter = require('./me');
const dashboardRouter = require('./dashboard');
const procurementRouter = require('./procurement');

function buildRouter() {
  const router = express.Router();
  router.use('/me', meRouter);
  router.use('/dashboard', dashboardRouter);
  router.use('/procurement', procurementRouter);
  return router;
}

module.exports = { buildRouter };
