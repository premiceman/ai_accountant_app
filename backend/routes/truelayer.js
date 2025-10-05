// backend/routes/truelayer.js
const express = require('express');
const crypto = require('crypto');
const User = require('../models/User');
const {
  ensureBaseIntegration,
  buildConnectionKey,
  normaliseKey,
  sanitiseInstitution,
  pruneSessions
} = require('../utils/integrationHelpers');
const {
  exchangeCodeForToken,
  fetchAccounts,
  fetchInfo
} = require('../services/truelayer');

const router = express.Router();

function parseStateParam(state) {
  if (!state) return null;
  const parts = String(state).split('.');
  if (parts.length < 2) return null;
  return { uid: parts[0], token: parts.slice(1).join('.') };
}

function appBaseUrl(req) {
  return process.env.APP_BASE_URL
    || process.env.FRONTEND_URL
    || process.env.PUBLIC_APP_URL
    || `${req.protocol}://${req.get('host')}`;
}

function renderRedirect(res, url) {
  res.redirect(url);
}

function sanitiseAccounts(accounts = []) {
  return accounts.map((account) => ({
    id: account.account_id || null,
    name: account.display_name || account.account_name || 'Account',
    currency: account.currency || 'GBP',
    type: account.account_type || null,
    iban: account.iban || null,
    sortCode: account.account_number?.sort_code || null,
    accountNumber: account.account_number?.number || null,
    provider: account.provider ? {
      id: account.provider.provider_id || null,
      name: account.provider.display_name || null,
      logo: account.provider.logo_uri || null
    } : null
  }));
}

function errorRedirect(req, res, reason) {
  const base = new URL('/profile.html', appBaseUrl(req));
  base.searchParams.set('integrations', 'truelayer-error');
  base.searchParams.set('reason', reason);
  renderRedirect(res, base.toString());
}

function successRedirect(req, res, connectionKey) {
  const base = new URL('/profile.html', appBaseUrl(req));
  base.searchParams.set('integrations', 'truelayer-success');
  if (connectionKey) base.searchParams.set('connection', connectionKey);
  renderRedirect(res, base.toString());
}

router.get('/callback', async (req, res) => {
  try {
    const { code, state, error, error_description: errorDescription } = req.query;

    if (error) {
      return errorRedirect(req, res, encodeURIComponent(`${error}: ${errorDescription || 'consent denied'}`));
    }

    const parsedState = parseStateParam(state);
    if (!parsedState?.uid || !parsedState?.token) {
      return errorRedirect(req, res, encodeURIComponent('invalid_state'));
    }

    const user = await User.findOne({ uid: parsedState.uid });
    if (!user) {
      return errorRedirect(req, res, encodeURIComponent('user_not_found'));
    }

    const sessions = Array.isArray(user.integrationSessions) ? user.integrationSessions : [];
    const idx = sessions.findIndex((session) => session.provider === 'truelayer' && session.state === parsedState.token);
    if (idx < 0) {
      return errorRedirect(req, res, encodeURIComponent('session_expired'));
    }

    const session = sessions[idx];
    if (!code) {
      return errorRedirect(req, res, encodeURIComponent('missing_code'));
    }

    const tokenPayload = await exchangeCodeForToken({
      code,
      redirectUri: process.env.TL_REDIRECT_URI,
      codeVerifier: session.codeVerifier
    });

    const accessToken = tokenPayload.access_token;
    if (!accessToken) {
      return errorRedirect(req, res, encodeURIComponent('missing_access_token'));
    }

    const accounts = await fetchAccounts(accessToken);
    let info = null;
    try {
      info = await fetchInfo(accessToken);
    } catch (err) {
      console.warn('TrueLayer info fetch failed:', err?.message || err);
    }

    const institutionFromSession = sanitiseInstitution(session.institution || {});
    const firstAccount = accounts[0] || {};
    const providerInfo = firstAccount.provider || info?.provider || {};

    const providerTokens = Array.isArray(session.metadata?.providerTokens)
      ? session.metadata.providerTokens
      : [];

    const institution = {
      ...institutionFromSession,
      id: institutionFromSession.id || providerInfo.provider_id || firstAccount.account_id || crypto.randomBytes(8).toString('hex'),
      name: institutionFromSession.name || providerInfo.display_name || firstAccount.display_name || 'TrueLayer connection',
      providerId: institutionFromSession.providerId || providerInfo.provider_id || null,
      providers: institutionFromSession.providers?.length ? institutionFromSession.providers : providerTokens,
      brandColor: institutionFromSession.brandColor || providerInfo.colour || null,
      accentColor: institutionFromSession.accentColor || null,
      icon: institutionFromSession.icon || providerInfo.logo_uri || null,
      tagline: institutionFromSession.tagline || providerInfo.segment || null
    };

    const connectionId = `${institution.id}-${crypto.randomBytes(4).toString('hex')}`;
    const connectionKey = buildConnectionKey('truelayer', connectionId);

    const list = Array.isArray(user.integrations) ? [...user.integrations] : [];
    ensureBaseIntegration(list, 'truelayer', 'TrueLayer Open Banking');
    const baseIdx = list.findIndex((item) => normaliseKey(item.key) === 'truelayer');
    if (baseIdx >= 0) {
      list[baseIdx] = {
        ...list[baseIdx],
        status: 'connected',
        lastCheckedAt: new Date(),
        metadata: {
          ...(list[baseIdx].metadata || {}),
          lastConnectedAt: new Date(),
          sandbox: process.env.TL_USE_SANDBOX === 'true'
        }
      };
    }

    const credentials = {
      tokenType: tokenPayload.token_type || 'Bearer',
      accessToken,
      refreshToken: tokenPayload.refresh_token || null,
      expiresAt: tokenPayload.expires_in ? new Date(Date.now() + tokenPayload.expires_in * 1000) : null,
      scope: tokenPayload.scope || session.scopes?.join(' ')
    };

    const payload = {
      key: connectionKey,
      label: institution.name,
      status: 'connected',
      lastCheckedAt: new Date(),
      metadata: {
        type: 'bank_connection',
        provider: 'truelayer',
        connectionId,
        institution,
        accounts: sanitiseAccounts(accounts),
        credentials,
        sandbox: process.env.TL_USE_SANDBOX === 'true',
        addedAt: new Date(),
        lastRefreshedAt: new Date(),
        info,
        scopes: session.scopes || [],
        providerTokens
      }
    };

    const existingIdx = list.findIndex((item) => item.key === payload.key);
    if (existingIdx >= 0) list[existingIdx] = payload;
    else list.push(payload);

    user.integrations = list;
    user.integrationSessions = pruneSessions(sessions.filter((_, i) => i !== idx));
    await user.save();

    return successRedirect(req, res, connectionKey);
  } catch (err) {
    console.error('TrueLayer callback failed:', err);
    return errorRedirect(req, res, encodeURIComponent('callback_error'));
  }
});

module.exports = router;
