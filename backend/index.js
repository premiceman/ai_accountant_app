/**
 * backend/index.js
 * Augmented to add:
 *  - /api/r2 (presign/commit/preview)
 *  - /api/analytics (dashboard aggregates)
 *  - /api/truelayer (OAuth connect + ingest)
 *  - /api/internal (validate/extract/materialize; protected with INTERNAL_API_KEY)
 *  - Cloudflare Queues polling (startQueuePolling)
 *
 * Existing functionality is preserved via safeRequire() + mount().
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const mongoose = require('mongoose');

// Optional middlewares (only if installed)
const compression = safeRequire('compression');
const helmet = safeRequire('helmet');

// ----------------------------------------------------------------------------
// App
// ----------------------------------------------------------------------------
const app = express();
app.set('trust proxy', 1);

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

// --- CSP quick-unblock (put near top, after app creation) ---
app.use((req, res, next) => {
  // WARNING: 'unsafe-inline' reduces protection. This is to get you moving quickly.
  // Later, replace inline scripts with external files or add nonces/hashes.
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "connect-src 'self' https://*.r2.cloudflarestorage.com https://api.cloudflare.com https://auth.truelayer.com https://api.truelayer-sandbox.com",
      "frame-src 'self' blob: data:",
      "object-src 'none'"
    ].join('; ')
  );
  next();
});


// ----------------------------------------------------------------------------
/**
 * Existing Routers (loaded if present)
 * Keep your current behavior: these are only mounted when the file exists.
 * If you already mounted them elsewhere, safeRequire will be null here and do nothing.
 */
const docGridRouter   = safeRequire('./src/routes/documents.routes') || safeRequire('./routes/documents.routes');
const docsRouter      = safeRequire('./src/routes/docs.routes')      || safeRequire('./routes/docs.routes');
const eventsRouter    = safeRequire('./src/routes/events.routes')    || safeRequire('./routes/events.routes');
const summaryRouter   = safeRequire('./src/routes/summary.routes')   || safeRequire('./routes/summary.routes');
const userRouter      = safeRequire('./src/routes/user.routes')      || safeRequire('./routes/user.routes');

// Mount existing routes (no changes)
mount('/api/documents', docGridRouter, 'documents');
mount('/api/docs',      docsRouter,    'docs');
mount('/api/events',    eventsRouter,  'events');
mount('/api/summary',   summaryRouter, 'summary');
mount('/api/user',      userRouter,    'user');

// ----------------------------------------------------------------------------
/**
 * NEW Routers (our additions)
 * These files were provided in previous messages:
 *   - backend/src/routes/r2.routes.js
 *   - backend/src/routes/analytics.routes.js
 *   - backend/src/routes/truelayer.routes.js
 *   - backend/src/routes/internal.routes.js
 *
 * They will only be mounted if the files exist.
 */
const r2Router        = safeRequire('./src/routes/r2.routes')         || safeRequire('./routes/r2.routes');
const analyticsRouter = safeRequire('./src/routes/analytics.routes')  || safeRequire('./routes/analytics.routes');
const truelayerRouter = safeRequire('./src/routes/truelayer.routes')  || safeRequire('./routes/truelayer.routes');
const internalRouter  = safeRequire('./src/routes/internal.routes')   || safeRequire('./routes/internal.routes');

mount('/api/r2',         r2Router,        'r2');
mount('/api/analytics',  analyticsRouter, 'analytics');
mount('/api/truelayer',  truelayerRouter, 'truelayer');
mount('/api/internal',   internalRouter,  'internal');

// ----------------------------------------------------------------------------
// Static hosting (keep your existing setup; this is non-invasive)
const FRONTEND_DIRS = [
  path.join(__dirname, '../frontend'),
  path.join(__dirname, '../public')
];
FRONTEND_DIRS.forEach(d => {
  app.use(express.static(d, { index: false }));
});

// Optionally serve your SPA/HTML if you rely on direct file paths:
app.get(['/','/home.html','/login.html','/document-vault.html','/profile.html','/billing.html'], (req, res, next) => {
  // Try to find file in known static folders; if not found, fallthrough.
  const candidate = FRONTEND_DIRS
    .map(d => path.join(d, req.path === '/' ? 'index.html' : req.path.replace(/^\//, '')))
    .find(fp => fileExists(fp));
  if (candidate) return res.sendFile(candidate);
  return next();
});

// ----------------------------------------------------------------------------
// MongoDB connection (preserve your existing behavior; fall back to MONGODB_URI)
const MONGODB_URI = process.env.MONGODB_URI || process.env.DB_URI || process.env.MONGO_URL || '';
if (!mongoose.connection.readyState) {
  mongoose.set('strictQuery', true);
  mongoose.connect(MONGODB_URI, {
    // Add your preferred options here
  }).then(() => {
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

  // Start HTTP server
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });

  // Start Cloudflare Queues poller (only if file exists)
  const qc = safeRequire('./src/queue-consumer') || safeRequire('./queue-consumer');
  if (qc && typeof qc.startQueuePolling === 'function') {
    console.log('⏱️  Starting Cloudflare Queues polling…');
    qc.startQueuePolling();
  } else {
    console.log('ℹ️  Queue consumer not found; skipping polling (this is fine for local or until you add files).');
  }
}

// ----------------------------------------------------------------------------
// Helpers
function safeRequire(p) {
  try {
    const mod = require(p);
    // In case of ESModule default export interop
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

