// /backend/server.js
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const app = express();

const isProd = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;

// --- Security & parsing
app.set('trust proxy', 1); // Render proxy -> required for secure cookies
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// --- DB (Mongo Atlas)
require('./src/db').connect(); // see /backend/src/db.js below

// --- Health check
app.get('/health', (_req,res) => res.json({ ok: true }));

// --- API routes (mount your existing routers here)
app.post('/auth/login', async (req, res) => {
  // TODO: Replace with your real auth
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ message: 'Missing credentials' });

  // Example token (replace with real session/JWT)
  const token = 'example.jwt.token';
  res.cookie('sid', token, {
    httpOnly: true,
    secure: true,     // Render is HTTPS
    sameSite: 'lax',  // same-site is fine because same-origin
    path: '/',
    maxAge: 1000*60*60*24*7
  });
  res.json({ ok: true });
});

// --- Serve frontend from backend (same origin)
const frontendDir = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendDir));
app.get('*', (_req, res) => res.sendFile(path.join(frontendDir, 'index.html')));

// --- Start
app.listen(PORT, '0.0.0.0', () => {
  console.log(`API listening on ${PORT} (prod=${isProd})`);
});
