const express = require('express');
const adminRequeue = require('./routes/admin.requeue.routes.js');

function registerAdminRoutes(app) {
  const instance = app || express();
  if (typeof instance.use === 'function') {
    instance.use(adminRequeue);
  }
  return instance;
}

module.exports = registerAdminRoutes;
