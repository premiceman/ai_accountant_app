// NOTE: Hotfix — TS types for shared flags + FE v1 flip + staged loader + prefer-v1 legacy; aligns with Phase-1/2/3 specs. Additive, non-breaking.
// backend/index.js
require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
let morgan; try { morgan = require('morgan'); } catch { morgan = () => (req,res,next)=>next(); }
const mongoose = require('mongoose');

// Helper to require modules without crashing if missing
function safeRequire(modPath) { try { return require(modPath); } catch { return null; } }

// ---- Routers (mount only if found) ----
const authRouter    = safeRequire('./routes/auth')                  || safeRequire('./src/routes/auth');
const userRouter    = safeRequire('./routes/user')                  || safeRequire('./src/routes/user') || safeRequire('./src/routes/user.routes');
const aiRouter     = safeRequire('./routes/ai')                   || safeRequire('./src/routes/ai');


const docsRouter =
  safeRequire('./src/routes/documents.routes')  ||
  safeRequire('./routes/documents.routes')      ||
  safeRequire('./src/routes/docs.routes')       ||
  safeRequire('./routes/docs.routes');

const eventsRouter  = safeRequire('./src/routes/events.routes')     || safeRequire('./routes/events.routes');
const summaryRouter = safeRequire('./src/routes/summary.routes')    || safeRequire('./routes/summary.routes');
const billingRouter = safeRequire('./routes/billing')               || safeRequire('./src/routes/billing');
const vaultRouter  = safeRequire('./routes/vault')                || safeRequire('./src/routes/vault');
const integrationsRouter = safeRequire('./routes/integrations')     || safeRequire('./src/routes/integrations');
const analyticsRouter = safeRequire('./routes/analytics')           || safeRequire('./src/routes/analytics');
const flagsRouter     = safeRequire('./src/routes/flags')           || safeRequire('./routes/flags');
const taxRouter       = safeRequire('./routes/tax')                 || safeRequire('./src/routes/tax');
const filesRouter     = safeRequire('./routes/files');
const ragRouter       = safeRequire('./routes/rag');
const jobsRouter      = safeRequire('./routes/jobs');
const truelayerRouter  = null;
const qaDevRouter    = safeRequire('./src/routes/__qa__.routes')   || safeRequire('./routes/__qa__');
const jsonTestRouter = safeRequire('./src/routes/jsonTest.routes');
const jsonTestAsyncRouter = safeRequire('./src/routes/jsonTest.async.routes');
const pdfTrimRouter = safeRequire('./src/routes/pdfTrim.routes') || safeRequire('./routes/pdfTrim.routes');
const adminRequeueRouter = safeRequire('./src/routes/admin.requeue.routes.js') || safeRequire('./routes/admin.requeue.routes');

// ---- AUTH GATE ----
const { requireAuthOrHtmlUnauthorized } = safeRequire('./middleware/authGate') || { requireAuthOrHtmlUnauthorized: null };

const app = express();
const PORT = process.env.PORT || 3000;

const FRONTEND_DIR = path.join(__dirname, '../frontend');
const UPLOADS_DIR  = path.join(__dirname, '../uploads');
const DATA_DIR     = path.join(__dirname, '../data');

const isProd = process.env.NODE_ENV === 'production';
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',').map((origin) => origin.trim()).filter(Boolean);


// ---- Middleware ----
app.use(morgan('combined'));
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (!key) continue;
    out[key] = decodeURIComponent(rest.join('=') || '');
  }
  return out;
}

function serializeCookie(name, value, options = {}) {
  const pieces = [`${name}=${encodeURIComponent(value)}`];
  if (typeof options.maxAge === 'number') {
    pieces.push(`Max-Age=${Math.floor(options.maxAge / 1000)}`);
  }
  if (options.domain) pieces.push(`Domain=${options.domain}`);
  pieces.push(`Path=${options.path || '/'}`);
  if (options.httpOnly) pieces.push('HttpOnly');
  if (options.secure) pieces.push('Secure');
  if (options.sameSite) pieces.push(`SameSite=${options.sameSite}`);
  return pieces.join('; ');
}

app.use((req, res, next) => {
  req.cookies = parseCookies(req.headers.cookie || '');
  res.cookie = (name, value, options = {}) => {
    const serialised = serializeCookie(name, value, options);
    const existing = res.getHeader('Set-Cookie');
    if (!existing) {
      res.setHeader('Set-Cookie', serialised);
    } else if (Array.isArray(existing)) {
      res.setHeader('Set-Cookie', [...existing, serialised]);
    } else {
      res.setHeader('Set-Cookie', [existing, serialised]);
    }
    return res;
  };
  res.clearCookie = (name, options = {}) => {
    const opts = { ...options, maxAge: 0 };
    res.cookie(name, '', opts);
    return res;
  };
  next();
});

app.use(express.json({ limit: '10mb' }));

const CSRF_COOKIE_NAME = 'csrfToken';

app.use((req, res, next) => {
  if (!req.path.startsWith('/api')) {
    return next();
  }
  const method = req.method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    let token = req.cookies[CSRF_COOKIE_NAME];
    if (!token) {
      token = crypto.randomBytes(32).toString('hex');
    }
    res.cookie(CSRF_COOKIE_NAME, token, { httpOnly: false, sameSite: 'lax', secure: isProd });
    return next();
  }
  const cookieToken = req.cookies[CSRF_COOKIE_NAME];
  const headerToken = req.headers['x-csrf-token'] || req.headers['x-xsrf-token'] || req.body?._csrf || req.query?._csrf;
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  return next();
});

// ---- Static ----
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/data', express.static(DATA_DIR)); // optional
app.use(express.static(FRONTEND_DIR));      // serves your HTML/JS/CSS

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

// ---- API mounts ----
mount('/api/auth', authRouter, 'auth');
if (authRouter?.handleWorkOSCallback) {
  app.get('/callback', authRouter.handleWorkOSCallback);
}
mount('/api/user', userRouter, 'user');

// Protect docs endpoints with Unauthorized page/JSON
if (requireAuthOrHtmlUnauthorized && docsRouter) {
  app.use('/api/docs', requireAuthOrHtmlUnauthorized);
  app.use('/api/documents', requireAuthOrHtmlUnauthorized);
}
mount('/api/docs', docsRouter, 'documents');
mount('/api/documents', docsRouter, 'documents (alias)');

mount('/api/events', eventsRouter, 'events');
mount('/api/summary', summaryRouter, 'summary');
mount('/api/billing', billingRouter, 'billing');
mount('/api/ai', aiRouter, 'ai');
mount('/api/vault', vaultRouter, 'vault');
mount('/api/analytics', analyticsRouter, 'analytics');
mount('/api/flags', flagsRouter, 'flags');
mount('/api/tax', taxRouter, 'tax');
mount('/api/json-test', jsonTestRouter, 'json-test');
mount('/api/json-test', jsonTestAsyncRouter, 'json-test-async');
mount('/api/pdf', pdfTrimRouter, 'pdf');
mount('/api', filesRouter, 'files');
mount('/api', ragRouter, 'rag');
mount('/api', jobsRouter, 'jobs');
mount('/', adminRequeueRouter, 'admin-requeue');
if (qaDevRouter) {
  mount('/__qa__', qaDevRouter, 'qa-dev');
}




// ---- Frontend landing (keep explicit root) ----
app.get('/', (_req, res) => res.sendFile(path.join(FRONTEND_DIR, 'index.html')));

// ---- API 404s (JSON) AFTER all API routes ----
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// ---- Pretty 404 for non-API requests (HTML) ----
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next(); // already handled above
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();

  const accept = (req.headers.accept || '').toLowerCase();
  const wantsHtml = accept.includes('text/html') || accept === '*/*' || accept === '';
  if (!wantsHtml) return res.status(404).type('text/plain').send('Not Found');

  res.status(404).sendFile(path.join(FRONTEND_DIR, '404.html'));
});

// ---- Error handler ----
app.use((err, req, res, next) => {
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'CORS not allowed' });
  }
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  return next(err);
});

app.use((err, _req, res, _next) => {
  console.error('❌ Server error:', err);
  res.status(500).json({ error: 'Server error' });
});

// ---- Mongo + start ----
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai_accountant_app';
mongoose.connect(mongoUri, {})
  .then(() => {
    console.log('✅ Connected to MongoDB');
    const { start: startWorker } = safeRequire('./services/jobWorker') || { start: () => {} };
    if (typeof startWorker === 'function') {
      startWorker();
    }
    app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });
