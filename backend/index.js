/**
 * backend/index.js
 * Adds:
 *  - CSP header (allows jsDelivr + inline for now; fonts via data:)
 *  - HTML sanitizer for CSP <meta> tags (so header policy wins)
 * Keeps:
 *  - Your existing routers, poller, static hosting, Mongo connect
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = safeRequire('cookie-parser') || (() => (req, res, next) => next());
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

// Optional middlewares (only if installed)
const compression = safeRequire('compression');
const helmet = safeRequire('helmet');

const app = express();
app.set('trust proxy', 1);

/* -------------------- CSP HEADER --------------------
   Your pages load Bootstrap/Icons/Chart.js from jsDelivr and some inline scripts.
   Previous *meta* CSP inside HTML overrode our header and blocked CDN/inline.
   This header allows your current setup. Later, we can tighten CSP if you self-host.
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

// Optional security/perf if available (helmet here won’t override our CSP unless you enabled its CSP explicitly)
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
// HTML sanitizer before static: strip any <meta http-equiv="Content-Security-Policy"> in HTML
const FRONTEND_DIRS = [
  path.join(__dirname, '../frontend'),
  path.join(__dirname, '../public')
];
const HTML_ROUTES = ['/', '/index.html', '/home.html', '/login.html', '/document-vault.html', '/profile.html', '/billing.html'];

app.get(HTML_ROUTES, (req, res, next) => {
  try {
    const fileRel = req.path === '/' ? 'index.html' : req.path.replace(/^\//, '');
    const candidate = FRONTEND_DIRS
      .map(d => path.join(d, fileRel))
      .find(fp => fs.existsSync(fp));
    if (!candidate) return next();

    let html = fs.readFileSync(candidate, 'utf8');
    // Remove any meta CSP from the HTML so our header policy is the only one applied
    html = html.replace(/<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');
    res.type('html').send(html);
  } catch (e) {
    return next(e);
  }
});

// ----------------------------------------------------------------------------
// Static hosting for all other assets
FRONTEND_DIRS.forEach(d => {
  app.use(express.static(d, { index: false }));
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

module.exports = app;
