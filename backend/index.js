// backend/index.js
require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
let morgan; try { morgan = require('morgan'); } catch { morgan = () => (req,res,next)=>next(); }
const mongoose = require('mongoose');

// Helper to require modules without crashing if missing
function safeRequire(modPath) { try { return require(modPath); } catch { return null; } }

// ---- Routers (mount only if found) ----
const authRouter    = safeRequire('./routes/auth')                  || safeRequire('./src/routes/auth');
const userRouter    = safeRequire('./routes/user')                  || safeRequire('./src/routes/user') || safeRequire('./src/routes/user.routes');

const docsRouter =
  safeRequire('./src/routes/documents.routes')  ||
  safeRequire('./routes/documents.routes')      ||
  safeRequire('./src/routes/docs.routes')       ||
  safeRequire('./routes/docs.routes');

const eventsRouter  = safeRequire('./src/routes/events.routes')     || safeRequire('./routes/events.routes');
const summaryRouter = safeRequire('./src/routes/summary.routes')    || safeRequire('./routes/summary.routes');
const billingRouter = safeRequire('./routes/billing')               || safeRequire('./src/routes/billing');

// ---- Strict Auth ----
const { requireAuthStrict } = safeRequire('./middleware/strictAuth') || { requireAuthStrict: null };

const app = express();
const PORT = process.env.PORT || 3000;

const FRONTEND_DIR = path.join(__dirname, '../frontend');
const UPLOADS_DIR  = path.join(__dirname, '../uploads');
const DATA_DIR     = path.join(__dirname, '../data');

// ---- Middleware ----
app.use(morgan('combined'));
app.use(cors({ origin: ['http://localhost:3000','http://localhost:8080'], credentials: true }));
app.use(express.json({ limit: '10mb' }));

// ---- Static ----
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/data', express.static(DATA_DIR)); // optional
app.use(express.static(FRONTEND_DIR));

// ---- Health ----
app.get('/api/ping', (_req, res) => res.json({ message: 'pong' }));
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Helper to mount protected routers
function mountProtected(prefix, router, name) {
  if (!router) {
    console.warn(`⚠️  Skipping ${name} router (module not found)`);
    return;
  }
  if (!requireAuthStrict) {
    console.warn(`⚠️  Strict auth middleware missing; denying unauthenticated relies on router internals`);
    app.use(prefix, router);
  } else {
    app.use(prefix, requireAuthStrict, router);
  }
  console.log(`✅ Mounted PROTECTED ${name} at ${prefix}`);
}

// ---- API mounts ----
// Public:
if (authRouter) { app.use('/api/auth', authRouter); console.log('✅ Mounted auth at /api/auth'); }

// Protected (no guests, must be logged in):
mountProtected('/api/user', userRouter, 'user');
mountProtected('/api/docs', docsRouter, 'documents');
mountProtected('/api/documents', docsRouter, 'documents (alias)');
mountProtected('/api/events', eventsRouter, 'events');
mountProtected('/api/summary', summaryRouter, 'summary');
mountProtected('/api/billing', billingRouter, 'billing');

// ---- Frontend landing ----
app.get('/', (_req, res) => res.sendFile(path.join(FRONTEND_DIR, 'index.html')));

// ---- API 404s (JSON) AFTER all API routes ----
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// ---- Pretty 404 for non-API requests (HTML) ----
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const accept = (req.headers.accept || '').toLowerCase();
  const wantsHtml = accept.includes('text/html') || accept === '*/*' || accept === '';
  if (!wantsHtml) return res.status(404).type('text/plain').send('Not Found');
  res.status(404).sendFile(path.join(FRONTEND_DIR, '404.html'));
});

// ---- Error handler ----
app.use((err, _req, res, _next) => {
  console.error('❌ Server error:', err);
  res.status(500).json({ error: 'Server error' });
});

// ---- Mongo + start ----
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
