// backend/middleware/ensureAuthenticated.js
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const {
  extractSessionToken,
  issueSessionCookies,
  clearSessionCookies,
  SESSION_COOKIE_OPTIONS,
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
} = require('../utils/session');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me';

const HTML_METHODS = new Set(['GET', 'HEAD']);

function wantsHtml(req) {
  if (!req) return false;
  const accept = String(req.headers?.accept || '').toLowerCase();
  if (accept.includes('text/html')) return true;
  if (!accept && HTML_METHODS.has(req.method)) return true;
  return false;
}

function normaliseId(id) {
  if (!id) return null;
  try {
    if (mongoose.Types.ObjectId.isValid(id)) {
      return String(new mongoose.Types.ObjectId(id));
    }
  } catch (_) {
    return null;
  }
  return String(id);
}

async function resolvePrincipal(req) {
  if (req?.user?.id) {
    const id = normaliseId(req.user.id);
    if (id) {
      return {
        user: req.user,
        profile: null,
        token: req.authToken || null,
      };
    }
  }

  let token = null;
  const header = req?.headers?.authorization;
  if (typeof header === 'string' && /^bearer\s+/i.test(header)) {
    token = header.split(/\s+/)[1];
  }
  if (!token) {
    token = extractSessionToken(req);
  }

  if (!token) {
    return null;
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }

  const userId = normaliseId(payload?.id || payload?.sub);
  if (!userId) {
    return null;
  }

  const profile = await User.findById(userId).lean();
  if (!profile) {
    return null;
  }

  const principal = {
    id: String(profile._id),
    email: profile.email,
    roles: Array.isArray(profile.roles) ? profile.roles.slice() : [],
    licenseTier: profile.licenseTier,
  };

  req.user = principal;
  req.authToken = token;
  req.principalProfile = profile;
  return { user: principal, profile, token };
}

function respondUnauthorised(req, res) {
  if (wantsHtml(req)) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    return res.redirect(302, '/');
  }

  res.set('WWW-Authenticate', 'Bearer realm="phloat"');
  return res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Authentication required' });
}

function ensureAuthenticated(options = {}) {
  const cfg = {
    requireFreshSession: false,
    attachProfile: false,
    ...options,
  };

  return async function ensureAuthenticatedMiddleware(req, res, next) {
    try {
      const result = await resolvePrincipal(req);
      if (!result) {
        return respondUnauthorised(req, res);
      }

      if (cfg.attachProfile && !req.principalProfile) {
        req.principalProfile = await User.findById(result.user.id).lean();
      }

      res.locals.user = req.user;
      res.locals.principal = req.principalProfile;

      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');

      return next();
    } catch (err) {
      return next(err);
    }
  };
}

const ensureAuthenticatedApi = ensureAuthenticated();
const ensureAuthenticatedPage = ensureAuthenticated();

module.exports = {
  ensureAuthenticated,
  ensureAuthenticatedApi,
  ensureAuthenticatedPage,
  issueSessionCookies,
  clearSessionCookies,
  SESSION_COOKIE_OPTIONS,
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
};
