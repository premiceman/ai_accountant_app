// backend/src/routes/user.routes.js
const express = require('express');
const router = express.Router();

// GET /api/user/me
router.get('/me', (req, res) => {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json({
    id: req.user.id,
    email: req.user.email,
    role: req.user.role || 'user'
  });
});

module.exports = router;
