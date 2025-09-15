// backend/index.js
require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
let morgan; try { morgan = require('morgan'); } catch { morgan = () => (req,res,next)=>next(); }
const mongoose = require('mongoose');

function safeRequire(modPath) { try { return require(modPath); } catch { return null; } }

const cookieParser = safeRequire('cookie-parser');

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

const { requireAuth, requireAuthOrHtmlUnauthorized } =
  safeRequire('./middleware/authGate') || { requireAuth: null, requireAuthOrHtmlUnauthorized: null };

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1); // Render proxy for secure cookies

const FRONTEND_DIR = path.join(__dirname, '../frontend');
const UPLOADS_DIR  = path.join(__dirname, '../uploads');
const DATA_DIR     = path.join(__dirname, '../data');

app.use(morgan('combined'));
app.use(cors({ origin: ['http://localhost:3000','http://localhost:8080'], credentials: true }));
app.use(express.json({ limit: '10mb' }));
if (cookieParser) app.use(cookieParser()); else console.warn('⚠️ cookie-parser not installed.');

app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/data', express.static(DATA_DIR));
app.use(express.static(FRONTEND_DIR));

function mount(prefix, router, name) {
  if (!router) { console.warn(`⚠️  Skipping ${name} router`); return; }
  app.use(prefix, router);
  console.log(`✅ Mounted ${name} at ${prefix}`);
}

app.get('/api/ping', (_req, res) => res.json({ message: 'pong' }));
app.get('/api/health', (_req, res) => res.json({ ok: true }));

mount('/api/auth', authRouter, 'auth');

if (requireAuth) {
  app.use('/api/user', requireAuth);
  app.use('/api/events', requireAuth);
  app.use('/api/summary', requireAuth);
  app.use('/api/billing', requireAuth);
  if (requireAuthOrHtmlUnauthorized) {
    app.use('/api/docs', requireAuthOrHtmlUnauthorized);
    app.use('/api/documents', requireAuthOrHtmlUnauthorized);
  } else {
    app.use('/api/docs', requireAuth);
    app.use('/api/documents', requireAuth);
  }
}

mount('/api/user', userRouter, 'user');
mount('/api/docs', docsRouter, 'documents');
mount('/api/documents', docsRouter, 'documents (alias)');
mount('/api/events', eventsRouter, 'events');
mount('/api/summary', summaryRouter, 'summary');
mount('/api/billing', billingRouter, 'billing');

app.get('/', (_req, res) => res.sendFile(path.join(FRONTEND_DIR, 'index.html')));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const accept = (req.headers.accept || '').toLowerCase();
  const wantsHtml = accept.includes('text/html') || accept === '*/*' || accept === '';
  if (!wantsHtml) return res.status(404).type('text/plain').send('Not Found');
  res.status(404).sendFile(path.join(FRONTEND_DIR, '404.html'));
});

app.use((err, _req, res, _next) => {
  console.error('❌ Server error:', err);
  res.status(500).json({ error: 'Server error' });
});

const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai_accountant_app';
mongoose.connect(mongoUri, {})
  .then(() => {
    console.log('✅ Connected to MongoDB');
    app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });
