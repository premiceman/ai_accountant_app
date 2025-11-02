// NOTE: Hotfix — TS types for shared flags + FE v1 flip + staged loader + prefer-v1 legacy; aligns with Phase-1/2/3 specs. Additive, non-breaking.
// backend/index.js
require('dotenv').config();
require('./config');

const path = require('path');
const express = require('express');
const cors = require('cors');
let morgan; try { morgan = require('morgan'); } catch { morgan = () => (req,res,next)=>next(); }
const mongoose = require('mongoose');
const csrfProtection = require('./middleware/csrf');
const {
  ensureAuthenticatedPage,
} = require('./middleware/ensureAuthenticated');

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
const analyticsEngine = safeRequire('./src/services/analytics/engine');
const flagsRouter     = safeRequire('./src/routes/flags')           || safeRequire('./routes/flags');
const taxRouter       = safeRequire('./routes/tax')                 || safeRequire('./src/routes/tax');
const truelayerRouter  = null;
const qaDevRouter    = safeRequire('./src/routes/__qa__.routes')   || safeRequire('./routes/__qa__');
const jsonTestRouter = safeRequire('./src/routes/jsonTest.routes');
const jsonTestAsyncRouter = safeRequire('./src/routes/jsonTest.async.routes');
const pdfTrimRouter = safeRequire('./src/routes/pdfTrim.routes') || safeRequire('./routes/pdfTrim.routes');
const adminRequeueRouter = safeRequire('./src/routes/admin.requeue.routes.js') || safeRequire('./routes/admin.requeue.routes');
const jobsRouter = safeRequire('./src/routes/jobs.routes.js') || safeRequire('./routes/jobs.routes');
const meRouter = safeRequire('./routes/me') || safeRequire('./src/routes/me');

// ---- AUTH GATE ----
const { requireAuthOrHtmlUnauthorized } = safeRequire('./middleware/authGate') || { requireAuthOrHtmlUnauthorized: null };

const app = express();
const PORT = process.env.PORT || 3000;

const FRONTEND_DIR = path.join(__dirname, '../frontend');
const PUBLIC_DIR   = path.join(FRONTEND_DIR, 'public');
const UPLOADS_DIR  = path.join(__dirname, '../uploads');
const DATA_DIR     = path.join(__dirname, '../data');

const DEFAULT_CORS = 'https://phloat.io,https://www.phloat.io,http://localhost:3000,http://localhost:8080';
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || DEFAULT_CORS)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const corsErrorMessage = 'CORS_ORIGIN_FORBIDDEN';

const FAVICON_SVG = Buffer.from(
  [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">',
    '<defs>',
    '<linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">',
    '<stop offset="0%" stop-color="#4f46e5"/>',
    '<stop offset="100%" stop-color="#14b8a6"/>',
    '</linearGradient>',
    '</defs>',
    '<rect width="64" height="64" rx="16" fill="url(#g)"/>',
    '<path fill="#ffffff" fill-opacity="0.9" d="M20 18h8l4 10 4-10h8l-8 20h-8z"/>',
    '</svg>',
  ].join(''),
  'utf8',
);

function resolveCorsOrigin(origin, callback) {
  if (!origin) {
    return callback(null, true);
  }
  if (allowedOrigins.includes(origin)) {
    return callback(null, true);
  }
  const error = new Error(corsErrorMessage);
  return callback(error);
}

app.set('trust proxy', 1);

app.use(morgan('combined'));
app.use((req, res, next) => {
  res.header('Vary', 'Origin');
  next();
});
app.use(cors({ origin: resolveCorsOrigin, credentials: true, optionsSuccessStatus: 204 }));
app.use((err, req, res, next) => {
  if (err && err.message === corsErrorMessage) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Origin not allowed' });
  }
  return next(err);
});
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/api', csrfProtection);

// ---- Static ----
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/data', express.static(DATA_DIR));
app.get('/favicon.ico', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
  res.type('image/svg+xml');
  res.send(FAVICON_SVG);
});
app.use('/public', express.static(PUBLIC_DIR, { maxAge: '30d', index: false }));
app.use('/css', express.static(path.join(FRONTEND_DIR, 'css'), { maxAge: '1h' }));
app.use('/js', express.static(path.join(FRONTEND_DIR, 'js'), { maxAge: '5m' }));
app.use('/assets', express.static(path.join(FRONTEND_DIR, 'assets'), { maxAge: '7d' }));
app.use('/components', express.static(path.join(FRONTEND_DIR, 'components'), { maxAge: '5m', index: false }));

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
mount('/api/jobs', jobsRouter, 'jobs');
mount('/api/v2/me', meRouter, 'me');
mount('/', adminRequeueRouter, 'admin-requeue');
if (qaDevRouter) {
  mount('/__qa__', qaDevRouter, 'qa-dev');
}




// ---- Frontend routing ----
function registerProtectedPage(route, file, legacy = []) {
  const absolute = path.join(FRONTEND_DIR, file);
  app.get(route, ensureAuthenticatedPage, (_req, res) => {
    res.sendFile(absolute);
  });
  legacy
    .filter((legacyRoute) => legacyRoute && legacyRoute !== route)
    .forEach((legacyRoute) => {
      app.get(legacyRoute, ensureAuthenticatedPage, (_req, res) => {
        res.redirect(302, route);
      });
    });
}

function registerPublicPage(route, file, legacy = []) {
  const absolute = path.join(FRONTEND_DIR, file);
  app.get(route, (_req, res) => {
    res.sendFile(absolute);
  });
  legacy
    .filter((legacyRoute) => legacyRoute && legacyRoute !== route)
    .forEach((legacyRoute) => {
      app.get(legacyRoute, (_req, res) => {
        res.redirect(302, route);
      });
    });
}

app.get('/', (_req, res) => res.sendFile(path.join(FRONTEND_DIR, 'index.html')));

registerPublicPage('/login', 'login.html', ['/login.html']);
registerPublicPage('/signup', 'signup.html', ['/signup.html']);
registerPublicPage('/legal', 'legal.html', ['/legal.html']);
registerPublicPage('/whats-new', 'whats-new.html', ['/whats-new.html']);
registerPublicPage('/unauthorized', 'unauthorized.html', ['/unauthorized.html']);

registerProtectedPage('/app', 'home.html', ['/home.html']);
registerProtectedPage('/app/home', 'home.html');
registerProtectedPage('/app/documents', 'documents.html', ['/documents.html']);
registerProtectedPage('/app/document-vault', 'document-vault.html', ['/document-vault.html']);
registerProtectedPage('/app/vault', 'vault.html', ['/vault.html']);
registerProtectedPage('/app/analytics', 'home.html');
registerProtectedPage('/app/compensation', 'compensation.html', ['/compensation.html']);
registerProtectedPage('/app/wealth-lab', 'wealth-lab.html', ['/wealth-lab.html']);
registerProtectedPage('/app/scenario-lab', 'scenario-lab.html', ['/scenario-lab.html']);
registerProtectedPage('/app/tax-lab', 'tax-lab.html', ['/tax-lab.html']);
registerProtectedPage('/app/json-test', 'json-test.html', ['/json-test.html']);
registerProtectedPage('/app/loan-management', 'loan-management.html', ['/loan-management.html']);
registerProtectedPage('/app/contract-management', 'contract-management.html', ['/contract-management.html']);
registerProtectedPage('/app/onboarding', 'onboarding.html', ['/onboarding.html']);
registerProtectedPage('/app/billing', 'billing.html', ['/billing.html']);
registerProtectedPage('/app/billing/checkout', 'billing-checkout.html', ['/billing-checkout.html']);
registerProtectedPage('/app/profile', 'profile.html', ['/profile.html']);

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
app.use((err, _req, res, _next) => {
  console.error('❌ Server error:', err);
  res.status(500).json({ error: 'Server error' });
});

// ---- Mongo + start ----
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai_accountant_app';
mongoose.connect(mongoUri, {})
  .then(() => {
    console.log('✅ Connected to MongoDB');
    if (analyticsEngine?.startAnalyticsEngine) {
      analyticsEngine.startAnalyticsEngine();
    }
    app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });
