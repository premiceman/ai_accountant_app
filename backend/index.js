// backend/index.js
require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
let morgan; try { morgan = require('morgan'); } catch { morgan = () => (req,res,next)=>next(); }
const mongoose = require('mongoose');

function safeRequire(p){ try { return require(p); } catch { return null; } }

// Routers
const authRouter    = safeRequire('./routes/auth')                  || safeRequire('./src/routes/auth');
const userRouter    = safeRequire('./routes/user')                  || safeRequire('./src/routes/user') || safeRequire('./src/routes/user.routes');
const docsRouter    =
  safeRequire('./src/routes/documents.routes') ||
  safeRequire('./routes/documents.routes')     ||
  safeRequire('./src/routes/docs.routes')      ||
  safeRequire('./routes/docs.routes');
const eventsRouter  = safeRequire('./src/routes/events.routes')     || safeRequire('./routes/events.routes');
const summaryRouter = safeRequire('./src/routes/summary.routes')    || safeRequire('./routes/summary.routes');
const billingRouter = safeRequire('./routes/billing')               || safeRequire('./src/routes/billing');

// Auth middleware(s)
const existingAuth  = safeRequire('./middleware/auth')              || safeRequire('./src/middleware/auth'); // your original verifier (sets req.user)
const strictAuthMod = safeRequire('./middleware/strictAuth');
const requireAuthStrict = strictAuthMod ? strictAuthMod.requireAuthStrict : null;

const app = express();
const PORT = process.env.PORT || 3000;

const FRONTEND_DIR = path.join(__dirname, '../frontend');
const UPLOADS_DIR  = path.join(__dirname, '../uploads');
const DATA_DIR     = path.join(__dirname, '../data');

// Middleware
app.use(morgan('combined'));
app.use(cors({ origin: ['http://localhost:3000','http://localhost:8080'], credentials: true }));
app.use(express.json({ limit: '10mb' }));

// Static
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/data', express.static(DATA_DIR));
app.use(express.static(FRONTEND_DIR));

// Health (public)
app.get('/api/ping', (_req, res) => res.json({ message: 'pong' }));
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Helper to mount with both middlewares if available
function protect(prefix, router, name) {
  if (!router) { console.warn(`⚠️ Skipping ${name} router (module not found)`); return; }
  const chain = [];
  if (existingAuth) chain.push(existingAuth);     // populate req.user using your current logic (JWT/cookie)
  if (requireAuthStrict) chain.push(requireAuthStrict); // enforce "must be real user, never guest"
  if (chain.length) {
    app.use(prefix, ...chain, router);
    console.log(`✅ Mounted PROTECTED ${name} at ${prefix} (middlewares: ${chain.length})`);
  } else {
    // last resort (dev only)
    app.use(prefix, router);
    console.warn(`⚠️ Mounted UNPROTECTED ${name} at ${prefix}`);
  }
}

// Public auth routes
if (authRouter) { app.use('/api/auth', authRouter); console.log('✅ Mounted auth at /api/auth'); }

// Protected API routes (now: existingAuth -> requireAuthStrict -> router)
protect('/api/user', userRouter, 'user');
protect('/api/docs', docsRouter, 'documents');
protect('/api/documents', docsRouter, 'documents (alias)');
protect('/api/events', eventsRouter, 'events');
protect('/api/summary', summaryRouter, 'summary');
protect('/api/billing', billingRouter, 'billing');

// Frontend landing
app.get('/', (_req, res) => res.sendFile(path.join(FRONTEND_DIR, 'index.html')));

// API 404 (JSON)
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Pretty 404 for non-API
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const accept = (req.headers.accept || '').toLowerCase();
  const wantsHtml = accept.includes('text/html') || accept === '*/*' || accept === '';
  if (!wantsHtml) return res.status(404).type('text/plain').send('Not Found');
  res.status(404).sendFile(path.join(FRONTEND_DIR, '404.html'));
});

// Error handler
app.use((err, _req, res, _next) => {
  console.error('❌ Server error:', err);
  res.status(500).json({ error: 'Server error' });
});

// Mongo + start
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai_accountant_app';
mongoose.connect(mongoUri, {})
  .then(() => {
    console.log('✅ Connected to MongoDB');
    app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });
