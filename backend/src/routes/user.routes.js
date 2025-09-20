// backend/src/routes/user.routes.js
const express = require('express');
const router = express.Router();

// Minimal /api/user/me for dashboard greeting
router.get('/me', (req, res) => {
  // If you already have auth, replace this with real user extraction
  res.json({ id: 'demo', email: 'demo@example.com', firstName: 'Alex' });
});

module.exports = router;
