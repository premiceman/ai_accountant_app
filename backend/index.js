// backend/index.js
require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
let morgan; try { morgan = require('morgan'); } catch { morgan = () => (req,res,next)=>next(); }
const mongoose = require('mongoose');

let cookieParser;
try { cookieParser = require('cookie-parser'); }
catch { cookieParser = null; }

function safeRequire(modPath) { try { return require(modPath); } catch { return null; } }

// ---- Routers (keep your flexible resolution) ----
const authRouter    = safeRequire('./routes/auth')                  || safeRequire('./src/routes/auth');
const userRouter    = safeRequire('./routes/user')                  || safeRequire('./src/routes/user') || safeRequire('./src/routes/user.routes');
const docsRouter    = safeRequire('./src/routes/documents.routes')  || safeRequire('./routes/documents.routes');
const eventsRouter  = safeRequire('./src/routes/events.routes')     || safeRequire('./routes/events.routes');
const summaryRouter = safeRequire('./src/routes/summary.routes')    || safeRequire('./routes/summary.routes');
const billingRouter = safeRequire('./routes/billing')               || safeRequire('./src/routes/billing');

const app = express();
const PORT = process.env.PORT || 3000;

// Behind a proxy (Render)
app.set('trust proxy', 1);

const FRONTEND_DIR = path.join(__dirname, '../frontend');
const UPLOADS_DIR  = path.join(__dirname, '../uploads');
const DATA_DIR     = path.join(__dirname, '../data');

// ---- Middleware ----
app.use(morgan('combined'));

// Allow localhost + your Render origin (extendable via env)
const allowedOrigins = new Set([
  'http://localhost:3000',
  'http://localhost:8080',
  'https://ai-accountant-app.onrender.com',
  ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()) : [])
]);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // same-origin/curl
    cb(null, allowedOrigins.has(origin));
  },
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
if (cookieParser) app.use(cookieParser());

// ---- Health ----
app.get('/api/ping', (_req, res) => res.json({ message: 'pong' }));
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ---- Protect specific HTML pages BEFORE static ----
const jwt = require('jsonwebtoken');
function readTokenFromReq(req) {
  const hdr = req.get('authorization') || '';
  const bearer = hdr.toLowerCase().startsWith('bearer ') ? hdr.slice(7).trim() : null;
  return bearer; // your APIs use Authorization; we don’t depend on cookies
}
function isAuthed(req) {
  const token = readTokenFromReq(req);
  if (!token) return false;
  try { jwt.verify(token, process.env.JWT_SECRET); return true; } catch { return false; }
}
const PROTECTED_PAGES = ['/home.html','/profile.html','/billing.html','/documents.html','/dashboard.html'];
PROTECTED_PAGES.forEach(p => {
  app.get(p, (req, res) => {
    if (isAuthed(req)) {
      return res.sendFile(path.join(FRONTEND_DIR, p.replace(/^\//, '')));
    }
    const nextUrl = encodeURIComponent(req.originalUrl || p);
    return res.redirect(`/login.html?next=${nextUrl}`);
  });
});

// ---- Static ----
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/data', express.static(DATA_DIR));
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

// ---- API mounts ----
mount('/api/auth', authRouter, 'auth');
mount('/api/user', userRouter, 'user');
mount('/api/docs', docsRouter, 'documents');
mount('/api/events', eventsRouter, 'events');
mount('/api/summary', summaryRouter, 'summary');
mount('/api/billing', billingRouter, 'billing');

// ---- Root ----
app.get('/', (_req, res) => res.sendFile(path.join(FRONTEND_DIR, 'index.html')));

// ---- API 404 AFTER routes ----
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// ---- Error handler ----
app.use((err, _req, res, _next) => {
  console.error('❌ Server error:', err);
  res.status(500).json({ error: 'Server error' });
});

// ---- Mongo + start ----
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai_accountant_app';
mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000, family: 4 })
  .then(() => {
    console.log('✅ Connected to MongoDB');
    app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });
