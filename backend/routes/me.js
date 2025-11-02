const express = require('express');
const User = require('../models/User');
const { ensureAuthenticatedApi } = require('../middleware/ensureAuthenticated');

const userRoutes = require('./user');

const toPublicUser = typeof userRoutes?.publicUser === 'function' ? userRoutes.publicUser : null;
const normaliseUsername = typeof userRoutes?.normaliseUsername === 'function'
  ? userRoutes.normaliseUsername
  : (value = '') => String(value).trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24);
const escapeRegex = typeof userRoutes?.escapeRegex === 'function'
  ? userRoutes.escapeRegex
  : (value = '') => String(value).replace(/[.*+\-?^${}()|[\]\\]/g, '\\$&');

const router = express.Router();

router.use(ensureAuthenticatedApi);

function toPlain(user) {
  if (!user) return null;
  if (typeof user.toObject === 'function') return user.toObject();
  return { ...user };
}

function serializeProfile(user) {
  if (!user) return null;
  const plain = toPlain(user) || {};

  const base = toPublicUser
    ? toPublicUser(user)
    : {
        id: plain._id,
        firstName: plain.firstName || '',
        lastName: plain.lastName || '',
        username: plain.username || '',
        email: plain.email || '',
        dateOfBirth: plain.dateOfBirth || null,
        profileInterests: Array.isArray(plain.profileInterests) ? plain.profileInterests : [],
        licenseTier: plain.licenseTier || 'free',
        roles: Array.isArray(plain.roles) ? plain.roles : ['user'],
        country: plain.country || 'uk',
        emailVerified: !!plain.emailVerified,
        subscription: plain.subscription || {},
        trial: plain.trial || null,
        onboarding: plain.onboarding || {},
        onboardingComplete: !!plain.onboardingComplete,
        onboardingSurvey: plain.onboardingSurvey || {},
        preferences: plain.preferences || {},
        usageStats: plain.usageStats || {},
        salaryNavigator: plain.salaryNavigator || {},
        wealthPlan: plain.wealthPlan || {},
        documentInsights: plain.documentInsights || {},
        integrations: Array.isArray(plain.integrations) ? plain.integrations : [],
        eulaAcceptedAt: plain.eulaAcceptedAt || null,
        eulaVersion: plain.eulaVersion || null,
        createdAt: plain.createdAt || null,
        updatedAt: plain.updatedAt || null,
      };

  const result = { ...base };
  const id = result.id || plain.id || plain._id;
  result.id = id ? String(id) : null;
  result.uid = plain.uid || result.uid || null;
  result.email = plain.email || result.email || '';
  result.firstName = plain.firstName || result.firstName || '';
  result.lastName = plain.lastName || result.lastName || '';
  result.username = plain.username || result.username || '';
  result.country = (plain.country || result.country || 'uk').toLowerCase();
  result.dateOfBirth = plain.dateOfBirth || result.dateOfBirth || null;
  result.licenseTier = result.licenseTier || plain.licenseTier || 'free';
  result.roles = Array.isArray(result.roles)
    ? result.roles
    : Array.isArray(plain.roles)
      ? plain.roles
      : ['user'];
  result.emailVerified =
    result.emailVerified != null ? result.emailVerified : !!plain.emailVerified;
  result.subscription = result.subscription || plain.subscription || {};
  result.trial = result.trial || plain.trial || null;
  result.preferences = result.preferences || plain.preferences || {};
  result.onboarding = result.onboarding || plain.onboarding || {};
  result.onboardingComplete =
    result.onboardingComplete != null ? result.onboardingComplete : !!plain.onboardingComplete;
  result.onboardingSurvey = result.onboardingSurvey || plain.onboardingSurvey || {};
  result.profileInterests = Array.isArray(result.profileInterests)
    ? result.profileInterests
    : Array.isArray(plain.profileInterests)
      ? plain.profileInterests
      : [];
  result.usageStats = result.usageStats || plain.usageStats || {};
  result.salaryNavigator = result.salaryNavigator || plain.salaryNavigator || {};
  result.wealthPlan = result.wealthPlan || plain.wealthPlan || {};
  result.documentInsights = result.documentInsights || plain.documentInsights || {};
  result.integrations = Array.isArray(result.integrations)
    ? result.integrations
    : Array.isArray(plain.integrations)
      ? plain.integrations
      : [];
  result.eulaAcceptedAt = result.eulaAcceptedAt || plain.eulaAcceptedAt || null;
  result.eulaVersion = result.eulaVersion || plain.eulaVersion || null;
  result.createdAt = result.createdAt || plain.createdAt || null;
  result.updatedAt = result.updatedAt || plain.updatedAt || null;

  const workos = plain.workos || {};
  result.workos = {
    userId: workos.userId || null,
    profileId: workos.profileId || null,
    organizationId: workos.organizationId || null,
    connectionId: workos.connectionId || null,
    lastSyncAt: workos.lastSyncAt || null,
  };

  return result;
}

router.get('/', async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res
        .status(401)
        .json({ code: 'UNAUTHENTICATED', message: 'Authentication required' });
    }

    const user = req.principalProfile || (await User.findById(userId));
    if (!user) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Profile not found' });
    }

    res.json({ me: serializeProfile(user) });
  } catch (err) {
    next(err);
  }
});

const PATCH_ALLOWED_FIELDS = new Set([
  'firstName',
  'lastName',
  'email',
  'username',
  'preferences',
  'profileInterests',
  'onboarding',
  'country',
]);

router.patch('/', async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res
        .status(401)
        .json({ code: 'UNAUTHENTICATED', message: 'Authentication required' });
    }

    const payload = req.body || {};
    const keys = Object.keys(payload);
    const invalidKeys = keys.filter((key) => !PATCH_ALLOWED_FIELDS.has(key));
    if (invalidKeys.length) {
      return res.status(400).json({
        code: 'INVALID_REQUEST',
        message: `Unsupported fields: ${invalidKeys.join(', ')}`,
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Profile not found' });
    }

    if ('firstName' in payload) {
      const firstName = String(payload.firstName || '').trim();
      if (!firstName) {
        return res
          .status(400)
          .json({ code: 'INVALID_REQUEST', message: 'firstName must be provided' });
      }
      user.firstName = firstName;
    }

    if ('lastName' in payload) {
      const lastName = String(payload.lastName || '').trim();
      if (!lastName) {
        return res
          .status(400)
          .json({ code: 'INVALID_REQUEST', message: 'lastName must be provided' });
      }
      user.lastName = lastName;
    }

    if ('email' in payload) {
      const email = String(payload.email || '').trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res
          .status(400)
          .json({ code: 'INVALID_REQUEST', message: 'email must be a valid address' });
      }
      const existingEmail = await User.findOne({ email, _id: { $ne: userId } }).lean();
      if (existingEmail) {
        return res
          .status(400)
          .json({ code: 'INVALID_REQUEST', message: 'Email already in use' });
      }
      user.email = email;
    }

    if ('username' in payload) {
      const raw = String(payload.username || '').trim();
      if (!raw) {
        user.username = '';
      } else {
        const normalized = normaliseUsername(raw);
        if (!normalized || normalized.length < 3) {
          return res.status(400).json({
            code: 'INVALID_REQUEST',
            message: 'username must be at least 3 characters',
          });
        }
        const regex = new RegExp(`^${escapeRegex(normalized)}$`, 'i');
        const conflict = await User.findOne({
          _id: { $ne: userId },
          username: { $regex: regex },
        }).lean();
        if (conflict) {
          return res
            .status(400)
            .json({ code: 'INVALID_REQUEST', message: 'Username already in use' });
        }
        user.username = normalized;
      }
    }

    if ('country' in payload) {
      const country = String(payload.country || '').toLowerCase();
      if (!['uk', 'us'].includes(country)) {
        return res
          .status(400)
          .json({ code: 'INVALID_REQUEST', message: 'country must be uk or us' });
      }
      user.country = country;
    }

    if ('preferences' in payload) {
      if (typeof payload.preferences !== 'object' || payload.preferences === null) {
        return res.status(400).json({
          code: 'INVALID_REQUEST',
          message: 'preferences must be an object',
        });
      }
      user.preferences = {
        ...(user.preferences?.toObject ? user.preferences.toObject() : user.preferences || {}),
        ...payload.preferences,
      };
    }

    if ('profileInterests' in payload) {
      if (!Array.isArray(payload.profileInterests)) {
        return res.status(400).json({
          code: 'INVALID_REQUEST',
          message: 'profileInterests must be an array',
        });
      }
      user.profileInterests = payload.profileInterests
        .filter((item) => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean);
    }

    if ('onboarding' in payload) {
      if (typeof payload.onboarding !== 'object' || payload.onboarding === null) {
        return res.status(400).json({
          code: 'INVALID_REQUEST',
          message: 'onboarding must be an object',
        });
      }
      user.onboarding = {
        ...(user.onboarding?.toObject ? user.onboarding.toObject() : user.onboarding || {}),
        ...payload.onboarding,
      };
    }

    await user.save();
    req.principalProfile = user;

    res.json({ me: serializeProfile(user) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
