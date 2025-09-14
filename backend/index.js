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

// Try both filenames for documents router
const docsRouter =
  safeRequire('./src/routes/documents.routes')  ||
  safeRequire('./routes/documents.routes')      ||
  safeRequire('./src/routes/docs.routes')       ||
  safeRequire('./routes/docs.routes');

const eventsRouter  = safeRequire('./src/routes/events.routes')     || safeRequire('./routes/events.routes');
const summaryRouter = safeRequire('./src/routes/summary.routes')    || safeRequire('./routes/summary.routes');
const billingRouter = safeRequire('./routes/billing')               || safeRequire('./src/routes/billing');

// ---- AUTH GATE (new) ----
const { requireAuthOrHtmlUnauthorized } = safeRequire('./middleware/authGate') || { requireAuthOrHtmlUnauthorized: null };

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

// ---- Mount helper ----
function mount(prefix, router, name) {
  if (!router) {
    console.warn(`⚠️  Skipping ${name} router (module not found)`);
    return;
  }
  app.use(prefix, router);
  console.log(`✅ Mounted ${name} at ${prefix}`);
}

// ---- Health ----
app.get('/api/ping', (_req, res) => res.json({ message: 'pong' }));
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ---- API mounts (once each) ----
mount('/api/auth', authRouter, 'auth');
mount('/api/user', userRouter, 'user');

// ---- Protect documents API with gate (HTML 401 page for browsers, JSON 401 for API) ----
if (requireAuthOrHtmlUnauthorized && docsRouter) {
  app.use('/api/docs', requireAuthOrHtmlUnauthorized);
  app.use('/api/documents', requireAuthOrHtmlUnauthorized);
}
mount('/api/docs', docsRouter, 'documents');
mount('/api/documents', docsRouter, 'documents (alias)');

mount('/api/events', eventsRouter, 'events');
mount('/api/summary', summaryRouter, 'summary');
mount('/api/billing', billingRouter, 'billing');

// ---- Frontend fallback ----
app.get('/', (_req, res) => res.sendFile(path.join(FRONTEND_DIR, 'index.html')));

// ---- API 404s AFTER routes ----
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

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
