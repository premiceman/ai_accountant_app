const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const router = express.Router();

// POST /api/user/login
router.post('/login', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  // Check if user exists or create new
  let user = await User.findOne({ email });
  if (!user) user = await User.create({ email });

  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user });
});

// GET /api/user/profile
router.get('/profile', async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });

  const token = auth.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    res.json(user);
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router;

const generateReport = require('../ai/reportGenerator');

// POST /api/user/report
router.post('/report', async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });

  const token = auth.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
	console.log('🔎 Generating report for:', user.email);
	console.log('📦 Payload:', JSON.stringify(req.body, null, 2));
	console.log('🔑 OpenAI Key?', !!process.env.OPENAI_API_KEY);


    const report = await generateReport(req.body); // Pass user data in body
    res.json({ summary: report });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});
