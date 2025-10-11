const jwt = require('jsonwebtoken');
const User = require('../models/User');

module.exports = async function(req, res, next) {
  const hdr = req.headers.authorization || '';
  const parts = hdr.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({ error: 'Missing token' });
  }
  const token = parts[1];

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  try {
    const user = await User.findById(decoded.id).select('_id');
    if (!user) {
      return res.status(401).json({ error: 'Account no longer exists' });
    }
    req.user = { id: user._id.toString() };
    next();
  } catch (err) {
    console.error('Auth middleware user lookup error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
