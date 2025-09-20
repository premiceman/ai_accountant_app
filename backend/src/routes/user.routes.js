// backend/src/routes/user.routes.js
const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../../models/User');

const router = express.Router();

// GET /api/user/me (used by Auth.enforce/requireAuth)
router.get('/me', async (req, res) => {
  try {
    const hdr = req.headers.authorization || '';
    const m = hdr.match(/^Bearer\s+(.+)$/i);
    if (!m) return res.status(401).json({ error: 'Missing token' });
    const token = m[1];
    const secret = process.env.JWT_SECRET || 'dev_secret_change_me';
    const decoded = jwt.verify(token, secret);
    const user = await User.findById(decoded.id).lean();
    if (!user) return res.status(404).json({ error: 'Not found' });
    return res.json({
      id: String(user._id),
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      role: user.role || 'user'
    });
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
});

module.exports = router;
