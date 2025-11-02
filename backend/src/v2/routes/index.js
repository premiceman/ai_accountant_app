const express = require('express');
const meRouter = require('./me');
const dashboardRouter = require('./dashboard');

function buildRouter() {
  const router = express.Router();
  router.use('/me', meRouter);
  router.use('/dashboard', dashboardRouter);
  return router;
}

module.exports = { buildRouter };
