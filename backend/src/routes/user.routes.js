// backend/src/routes/user.routes.js
// Bridge module that re-exports the primary user router defined in ../routes/user.js.
// This ensures legacy require paths continue working without serving stale stub data.

try {
  module.exports = require('../../routes/user');
} catch (err) {
  console.error('Failed to load backend/routes/user.js from src/routes/user.routes.js bridge.', err);
  const express = require('express');
  const router = express.Router();
  router.use((req, res) => {
    res.status(503).json({ error: 'User service unavailable' });
  });
  module.exports = router;
}
