/**
 * backend/index.js
 * Fixes: CSP blocks on CDN/inline by (1) stripping any meta CSP in HTML and (2) applying a header CSP.
 * Nothing else in your app is changed.
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

// Optional deps (won't crash if not installed)
function safeRequire(p) { try { const m = require(p); return m && m.__esModule ? m.default || m : m; } catch { return null; } }
const cookieParser = safeRequire('cookie-parser') || (() => (req, res, next) => next());
const compression  = safeRequire('compression');
const helmet       = safeRequire('helmet');

const app = express();
app.set('trust proxy', 1);

/* ---------------------------------- CSP HEADER ----------------------------------
   Your pages use jsDelivr (+ some inline <script>). A meta CSP in the HTML says
   "script-src 'self'", which overrides headers and blocks everything else.
   We'll (A) remove that meta tag from any HTML and (B) set a permissive header CSP.
---------------------------------------------------------------------------------- */
app.use((req, res, next) => {
  // Allow current setup to work. Later you can tighten this by self-hosting vendor files & removing inline JS.
  const csp = [
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
  ].join('; ');
  res.setHeader('Content-Security-Policy', csp);
  next();
});

/* ------------------------------- META CSP STRIPPER -------------------------------
   Strip ANY <meta http-equiv="Content-Security-Policy" ...> from HTML so the header CSP above controls.
   This applies to ALL .html paths and "/" (index.html) from your frontend/public folders.
---------------------------------------------------------------------------------- */
const FRONTEND_DIRS = [
  path.join(__dirname, '../frontend'),
  path.join(__dirname, '../public')
];

// Serve sanitized HTML for "/" and any "*.html" path.
app.get(/^\/$|^\/.*\.html$/i, (req, res, next) => {
  try {
    const fileRel = req.path === '/' ? 'index.html' : req.path.replace(/^\//, '');
    const candidate = FRONTEND_DIRS
      .map(d => path.join(d, fileRel))
      .find(fp => fs.existsSync(fp));
    if (!candidate) return next();

    let html = fs.readFileSync(candidate, 'utf8');
    // Remove ALL meta CSP tags (case-insensitive)
    html = html.replace(/<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>\s*/gi, '');
    res.type('html').send(html);
  } catch (e) {
    next(e);
  }
});

// Core middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Optional security/perf (helmet will NOT re-apply CSP unless you configured it to)
if (helmet) app.use(helmet());
if (compression) app.use(compression());

// CORS — keep permissive for now
const ALLOWED_ORIGINS = ['http://localhost:3000','http://127.0.0.1:3000','https://www.phloat.io'];
app.use(cors({
  origin: (origin, cb) => (!origin || ALLOWED_ORIGINS.includes(origin)) ? cb(null, true) : cb(null, true),
  credentials: true
}));

// Health
app.get('/health', (_req, res) => res.status(200).send('ok'));

/* ----------------------------------- ROUTERS ----------------------------------- */
function mount(route, router, label) { if (router) { app.use(route, router); console.log(`➡️  Mounted ${label || route} at ${route}`); } }
const docGridRouter   = safeRequire('./src/routes/documents.routes') || safeRequire('./routes/documents.routes');
const docsRouter      = safeRequire('./src/routes/docs.routes')      || safeRequire('./routes/docs.routes');
const eventsRouter    = safeRequire('./src/routes/events.routes')    || safeRequire('./routes/events.routes');
const summaryRouter   = safeRequire('./src/routes/summary.routes')   || safeRequire('./routes/summary.routes');
const userRouter      = safeRequire('./src/routes/user.routes')      || safeRequire('./routes/user.routes');

mount('/api/documents', docGridRouter, 'documents');
mount('/api/docs',      docsRouter,    'docs');
mount('/api/events',    eventsRouter,  'events');
mount('/api/summary',   summaryRouter, 'summary');
mount('/api/user',      userRouter,    'user');

// New (your earlier additions)
const r2Router        = safeRequire('./src/routes/r2.routes')         || safeRequire('./routes/r2.routes');
const analyticsRouter = safeRequire('./src/routes/analytics.routes')  || safeRequire('./routes/analytics.routes');
const truelayerRouter = safeRequire('./src/routes/truelayer.routes')  || safeRequire('./routes/truelayer.routes');
const internalRouter  = safeRequire('./src/routes/internal.routes')   || safeRequire('./routes/internal.routes');

mount('/api/r2',         r2Router,        'r2');
mount('/api/analytics',  analyticsRouter, 'analytics');
mount('/api/truelayer',  truelayerRouter, 'truelayer');
mount('/api/internal',   internalRouter,  'internal');

/* ---------------------------------- STATIC ---------------------------------- */
FRONTEND_DIRS.forEach(d => {
  app.use(express.static(d, { index: false }));
});

/* ------------------------------- MONGODB + BOOT ------------------------------- */
const MONGODB_URI = process.env.MONGODB_URI || process.env.DB_URI || process.env.MONGO_URL || '';
function boot() {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));

  // Queue poller (only if configured)
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

module.exports = app;
