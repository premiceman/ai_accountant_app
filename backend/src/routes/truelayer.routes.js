// backend/src/routes/truelayer.routes.js
const express = require('express');
const crypto = require('crypto');
const { URLSearchParams } = require('url');

const router = express.Router();

const TL_CLIENT_ID = process.env.TL_CLIENT_ID || '';
const TL_REDIRECT_URI = process.env.TL_REDIRECT_URI || 'https://www.phloat.io/api/truelayer/callback';
const TL_USE_SANDBOX = String(process.env.TL_USE_SANDBOX || 'true') === 'true';
const AUTH_BASE = TL_USE_SANDBOX ? 'https://auth.truelayer-sandbox.com' : 'https://auth.truelayer.com';

router.get('/connect', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: TL_CLIENT_ID,
    scope: 'info accounts transactions balance',
    redirect_uri: TL_REDIRECT_URI,
    providers: 'uk-ob-all',
    state
  });
  res.redirect(`${AUTH_BASE}/?${params.toString()}`);
});

router.get('/callback', (req, res) => {
  // TODO: exchange code for tokens
  res.send('TrueLayer callback received. Configure token exchange next.');
});

module.exports = router;
