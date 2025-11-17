const express = require('express');
const meRouter = require('./me');
const dashboardRouter = require('./dashboard');
const documentsRouter = require('./documents');

function buildRouter() {
  const router = express.Router();
  router.use('/me', meRouter);
  router.use('/dashboard', dashboardRouter);
  router.use('/documents', documentsRouter);
  return router;
}

module.exports = { buildRouter };
