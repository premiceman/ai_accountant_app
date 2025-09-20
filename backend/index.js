/**
 * backend/index.js
 * - CSP header (allows jsDelivr + inline) and strips meta CSP in HTML.
 * - Mounts auth, user, billing, vault, internal, truelayer routes.
 * - Starts Cloudflare Queue poller only if configured.
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

function safeRequire(p) { try { const m = require(p); return m && m.__esModule ? (m.default || m) : m; } catch { return null; } }
const cookieParser = safeRequire('cookie-parser') || (() => (req, res, next) => next());
const compression  = safeRequire('compression');
const helmet       = safeRequire('helmet');
const morgan       = safeRequire('morgan');

const app = express();
app.set('trust proxy', 1);

// CSP header (allow CDN + inline now; tighten later if you self-host assets)
app.use((req, res, next) => {
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

// Strip any <meta http-equiv="Content-Security-Policy"> inside HTML so server header wins
const FRONTEND_DIRS = [ path.join(__dirname, '../frontend'), path.join(__dirname, '../public') ];
app.get(/^\/$|^\/.*\.html$/i, (req, res, next) => {
  try {
    const fileRel = req.path === '/' ? 'index.html' : req.path.replace(/^\//, '');
    const candidate = FRONTEND_DIRS.map(d => path.join(d, fileRel)).find(fp => fs.existsSync(fp));
    if (!candidate) return next();
    let html = fs.readFileSync(candidate, 'utf8');
    html = html.replace(/<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>\s*/gi, '');
    res.type('html').send(html);
  } catch (e) { next(e); }
});

// Core middleware
if (morgan) app.use(morgan('tiny'));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(cookieParser());
if (helmet) app.use(helmet());
if (compression) app.use(compression());

// CORS
const ALLOWED_ORIGINS = ['http://localhost:3000','http://127.0.0.1:3000','https://www.phloat.io'];
app.use(cors({
  origin: (origin, cb) => (!origin || ALLOWED_ORIGINS.includes(origin)) ? cb(null, true) : cb(null, true),
  credentials: true
}));

// Health
app.get('/health', (_req, res) => res.status(200).send('ok'));

// Helpers
function mount(route, router, label) { if (router) { app.use(route, router); console.log(`➡️  Mounted ${label || route} at ${route}`); } }

// Routers
const authRouter      = require('./src/routes/auth.routes');
const userRouter      = require('./src/routes/user.routes');
const billingRouter   = require('./src/routes/billing.routes');
const vaultRouter     = require('./src/routes/vault.routes');
const internalRouter  = require('./src/routes/internal.routes');
const truelayerRouter = require('./src/routes/truelayer.routes');

mount('/api/auth',      authRouter,      'auth');
mount('/api/user',      userRouter,      'user');
mount('/api/billing',   billingRouter,   'billing');
mount('/api/vault',     vaultRouter,     'vault');
mount('/api/internal',  internalRouter,  'internal');
mount('/api/truelayer', truelayerRouter, 'truelayer');

// Static
FRONTEND_DIRS.forEach(d => app.use(express.static(d, { index: false })));

// Mongo + boot
const MONGODB_URI = process.env.MONGODB_URI || process.env.DB_URI || process.env.MONGO_URL || '';
function boot() {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));

  // Cloudflare Queues polling
  const qc = require('./src/queue-consumer');
  const shouldStartQueue = process.env.CF_QUEUES_ENABLED !== 'false' &&
    process.env.CF_QUEUES_API_TOKEN && process.env.CF_ACCOUNT_ID && process.env.CF_QUEUE_ID;
  if (qc && typeof qc.startQueuePolling === 'function' && shouldStartQueue) {
    console.log('⏱️  Starting Cloudflare Queues polling…');
    qc.startQueuePolling();
  } else {
    console.log('ℹ️  Queue polling disabled (missing config or CF_QUEUES_ENABLED=false).');
  }
}

if (MONGODB_URI) {
  mongoose.set('strictQuery', true);
  mongoose.connect(MONGODB_URI, {}).then(() => {
    console.log('✅ MongoDB connected');
    boot();
  }).catch(err => {
    console.error('❌ MongoDB connection error', err);
    process.exit(1);
  });
} else {
  console.warn('⚠️  No Mongo URI set; starting without DB.');
  boot();
}

module.exports = app;
