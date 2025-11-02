const path = require('path');
const express = require('express');
const cors = require('cors');
let morgan; try { morgan = require('morgan'); } catch { morgan = () => (req, res, next) => next(); }
const { ensureAuthenticatedApi, ensureAuthenticatedPage } = require('../../middleware/ensureAuthenticated');
const { buildRouter } = require('./routes');
const { connectMongo } = require('./models');

const FRONTEND_DIR = path.join(__dirname, '../../frontend');
const LANDING_DIR = path.join(FRONTEND_DIR, 'public');
const APP_DIR = path.join(FRONTEND_DIR, 'app');

function wantsHtml(req) {
  const accept = String(req.headers?.accept || '').toLowerCase();
  return accept.includes('text/html');
}

async function createApp() {
  await connectMongo();
  const app = express();
  app.set('trust proxy', 1);
  app.use(morgan('combined'));
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '5mb' }));

  const FAVICON_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAO0lEQVR4AWP4//8/Azbw////P4bBuP///w8DIP7//z9jEJwDkAEZQXQgEcgYiCSRAaEAADOoCEjgeAm8AAAAASUVORK5CYII=';

  app.get('/favicon.ico', (_req, res) => {
    res.type('image/png').send(Buffer.from(FAVICON_BASE64, 'base64'));
  });

  app.use('/assets', express.static(path.join(FRONTEND_DIR, 'assets'), { maxAge: '7d' }));

  app.get('/', (_req, res) => {
    res.sendFile(path.join(LANDING_DIR, 'index.html'));
  });

  app.use('/app', ensureAuthenticatedPage, express.static(APP_DIR, { index: false }));
  app.get('/app', ensureAuthenticatedPage, (_req, res) => {
    res.redirect('/app/dashboard');
  });
  app.get('/app/*', ensureAuthenticatedPage, (req, res) => {
    const subPath = req.params[0] || '';
    const filePath = path.join(APP_DIR, `${subPath}.html`);
    res.sendFile(filePath, (err) => {
      if (err) {
        res.status(404).sendFile(path.join(APP_DIR, '404.html'));
      }
    });
  });

  const apiRouter = buildRouter();
  app.use('/api/v2', ensureAuthenticatedApi, apiRouter);

  return app;
}

function attachErrorHandlers(app) {
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'Not found' });
    }
    return res.status(404).sendFile(path.join(APP_DIR, '404.html'), (err) => {
      if (err) {
        res.status(404).send('Not found');
      }
    });
  });
  app.use((err, req, res, _next) => {
    console.error('Unhandled error', err);
    if (req.path.startsWith('/api/')) {
      const status = err.statusCode || 500;
      res.status(status).json({ error: err.message || 'Internal Server Error', details: err.details || undefined });
      return;
    }
    if (wantsHtml(req)) {
      res.status(500).send('<h1>Server error</h1>');
      return;
    }
    res.status(500).json({ error: 'Internal Server Error' });
  });

  return app;
}

module.exports = { createApp, attachErrorHandlers };
