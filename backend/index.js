/*require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const mongoose = require('mongoose');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_DIR = path.join(__dirname, '../frontend');

app.use(morgan('combined'));
app.use(cors({ origin: ['http://localhost:3000','http://localhost:8080'], credentials: true }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/ping', (req, res) => res.json({ message: 'pong' }));
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);

// serve frontend
app.use(express.static(FRONTEND_DIR));
app.get('/', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'index.html')));

// API 404s
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Error handler
app.use((err, req, res, next) => { console.error('❌ Server error:', err); res.status(500).json({ error: 'Server error' }); });

const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai_accountant_app';
mongoose.connect(mongoUri, {})
  .then(() => {
    console.log('✅ Connected to MongoDB');
    app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
  })
  .catch((err) => { console.error('❌ MongoDB connection error:', err); process.exit(1); });*/

  require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
let morgan; try { morgan = require('morgan'); } catch { morgan = () => (req,res,next)=>next(); }
const mongoose = require('mongoose');

function safeRequire(p) { try { return require(p); } catch { return null; } }

// Try both locations in case files live under ./src/...
const authRoutes = safeRequire('./routes/auth') || safeRequire('./src/routes/auth');
const userRoutes = safeRequire('./routes/user') || safeRequire('./src/routes/user');
// backend/index.js (near the other requires)
const eventsRouter = require('./src/routes/events.routes'); // <-- add this


const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_DIR = path.join(__dirname, '../frontend');
app.use('/api/docs', require('./src/routes/documents.routes'));
app.use(morgan('combined'));
app.use(cors({ origin: ['http://localhost:3000','http://localhost:8080'], credentials: true }));
app.use(express.json({ limit: '1mb' }));

app.use(express.static(path.join(__dirname, '../frontend')));


// Helper to mount and log
function mount(pathPrefix, router, name) {
  if (!router) {
    console.warn(`⚠️  ${name} router NOT found; expected at ./routes/${name}.js or ./src/routes/${name}.js`);
    return;
  }
  app.use(pathPrefix, router);
  console.log(`✅ Mounted ${name} router at ${pathPrefix}`);
}

// --- API mounts (BEFORE any 404s)
app.get('/api/ping', (req, res) => res.json({ message: 'pong' }));
mount('/api/auth', authRoutes, 'auth');
mount('/api/user', userRoutes, 'user');
app.use('/api/summary', require('./src/routes/summary.routes'));
app.use('/api/docs', require('./src/routes/documents.routes'));
app.use('/api/billing', require('./routes/billing')); // 🆕 Billing API

// Health
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Events API
app.use('/api/events', eventsRouter);

// TEMP: route inspector to verify what's mounted
app.get('/__routes', (req, res) => {
  const dump = [];
  const walk = (stack, prefix = '') => {
    stack.forEach(layer => {
      if (layer.route?.path) {
        const methods = Object.keys(layer.route.methods).map(m => m.toUpperCase()).join(',');
        dump.push(`${methods} ${prefix}${layer.route.path}`);
      } else if (layer.name === 'router' && layer.handle?.stack) {
        walk(layer.handle.stack, prefix);
      }
    });
  };
  walk(app._router.stack);
  res.json({ routes: dump });
});

// serve frontend
app.use(express.static(FRONTEND_DIR));
app.get('/', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'index.html')));

// API 404s AFTER routes
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Error handler
app.use((err, req, res, next) => { console.error('❌ Server error:', err); res.status(500).json({ error: 'Server error' }); });

const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai_accountant_app';
mongoose.connect(mongoUri, {})
  .then(() => {
    console.log('✅ Connected to MongoDB');
    app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
  })
  .catch((err) => { console.error('❌ MongoDB connection error:', err); process.exit(1); });

