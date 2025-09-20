/**
 * backend/index.js
 * Adds:
 *  - CSP middleware (allows jsDelivr + inline for now, fonts via data:)
 *  - Everything else unchanged (safeRequire, mounts, poller boot, etc.)
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = safeRequire('cookie-parser') || (() => (req, res, next) => next());
const path = require('path');
const mongoose = require('mongoose');

// Optional middlewares (only if installed)
const compression = safeRequire('compression');
const helmet = safeRequire('helmet');

const app = express();
app.set('trust proxy', 1);

/* -------------------- CSP (FIX) --------------------
   Your pages load Bootstrap/Icons/Chart.js from jsDelivr and use some inline scripts.
   Previous CSP blocked CDN CSS & fonts, so the page looked unstyled.
   This policy ALLOWS those until you self-host vendor assets.
---------------------------------------------------- */
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "base-uri 'self'",
      "script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'",
      "style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'",
      "font-src 'self' https://cdn.jsdelivr.net data:",
      "img-src 'self' data: blob:",
      "connect-src 'self' https://*.r2.cloudflarestorage.com https://api.cloudflare.com https://auth.truelayer.com https://api.truelayer-sandbox.com",
      "frame-src 'self' blob: data:",
      "object-src 'none'",
      "upgrade-insecure-requests"
    ].join('; ')
  );
  next();
});

// Core middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Optional security/perf if available
if (helmet) app.use(helmet());
if (compression) app.use(compression());

// CORS — allow your frontend origins (adjust as needed)
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://www.phloat.io'
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(null, true); // relax for now; tighten in prod
  },
  credentials: true
}));

// Healthcheck
app.get('/health', (_req, res) => res.status(200).send('ok'));

// ----------------------------------------------------------------------------
// Existing Routers (loaded if present)
const docGridRouter   = safeRequire('./src/routes/documents.routes') || safeRequire('./routes/documents.routes');
const docsRouter      = safeRequire('./src/routes/docs.routes')      || safeRequire('./routes/docs.routes');
const eventsRouter    = safeRequire('./src/routes/events.routes')    || safeRequire('./routes/events.routes');
const summaryRouter   = safeRequire('./src/routes/summary.routes')   || safeRequire('./routes/summary.routes');
const userRouter      = safeRequire('./src/routes/user.routes')      || safeRequire('./routes/user.routes');

// Mount existing routes
mount('/api/documents', docGridRouter, 'documents');
mount('/api/docs',      docsRouter,    'docs');
mount('/api/events',    eventsRouter,  'events');
mount('/api/summary',   summaryRouter, 'summary');
mount('/api/user',      userRouter,    'user');

// ----------------------------------------------------------------------------
// NEW Routers (our additions)
const r2Router        = safeRequire('./src/routes/r2.routes')         || safeRequire('./routes/r2.routes');
const analyticsRouter = safeRequire('./src/routes/analytics.routes')  || safeRequire('./routes/analytics.routes');
const truelayerRouter = safeRequire('./src/routes/truelayer.routes')  || safeRequire('./routes/truelayer.routes');
const internalRouter  = safeRequire('./src/routes/internal.routes')   || safeRequire('./routes/internal.routes');

mount('/api/r2',         r2Router,        'r2');
mount('/api/analytics',  analyticsRouter, 'analytics');
mount('/api/truelayer',  truelayerRouter, 'truelayer');
mount('/api/internal',   internalRouter,  'internal');

// ----------------------------------------------------------------------------
// Static hosting (non-invasive)
const FRONTEND_DIRS = [
  path.join(__dirname, '../frontend'),
  path.join(__dirname, '../public')
];
FRONTEND_DIRS.forEach(d => {
  app.use(express.static(d, { index: false }));
});

app.get(['/','/home.html','/login.html','/document-vault.html','/profile.html','/billing.html'], (req, res, next) => {
  const candidate = FRONTEND_DIRS
    .map(d => path.join(d, req.path === '/' ? 'index.html' : req.path.replace(/^\//, '')))
    .find(fp => fileExists(fp));
  if (candidate) return res.sendFile(candidate);
  return next();
});

// ----------------------------------------------------------------------------
// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || process.env.DB_URI || process.env.MONGO_URL || '';
if (!mongoose.connection.readyState) {
  mongoose.set('strictQuery', true);
  mongoose.connect(MONGODB_URI, {}).then(() => {
    console.log('✅ MongoDB connected');
    boot();
  }).catch(err => {
    console.error('❌ MongoDB connection error', err);
    process.exit(1);
  });
} else {
  boot();
}

// ----------------------------------------------------------------------------
// Boot server + start queue poller
function boot() {
  const PORT = process.env.PORT || 3001;

  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });

  const qc = safeRequire('./src/queue-consumer') || safeRequire('./queue-consumer');
  const shouldStartQueue =
    process.env.CF_QUEUES_API_TOKEN &&
    process.env.CF_ACCOUNT_ID &&
    process.env.CF_QUEUE_ID &&
    (process.env.CF_QUEUES_ENABLED !== 'false');

  if (qc && typeof qc.startQueuePolling === 'function' && shouldStartQueue) {
    console.log('⏱️  Starting Cloudflare Queues polling…');
    qc.startQueuePolling();
  } else {
    console.log('ℹ️  Queue polling disabled (missing config or CF_QUEUES_ENABLED=false).');
  }
}

// ----------------------------------------------------------------------------
// Helpers
function safeRequire(p) {
  try {
    const mod = require(p);
    return mod && mod.__esModule && mod.default ? mod.default : mod;
  } catch (e) {
    if (process.env.DEBUG) console.warn(`[safeRequire] Could not load ${p}: ${e.message}`);
    return null;
  }
}

function mount(route, router, label) {
  if (!router) return;
  app.use(route, router);
  console.log(`➡️  Mounted ${label || route} at ${route}`);
}

function fileExists(fp) {
  try {
    const fs = require('fs');
    return fs.existsSync(fp);
  } catch {
    return false;
  }
}

module.exports = app;
