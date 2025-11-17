const User = require('../models/User');
const { forbidden } = require('../utils/errors');

function requireFeature(featureKey) {
  return async function requireFeatureMiddleware(req, res, next) {
    try {
      const profile = req.principalProfile || (await User.findById(req.user.id).lean());
      if (!profile) {
        return next(forbidden('Account not found'));
      }
      req.principalProfile = profile;
      const licenses = profile.featureLicenses || {};
      if (!licenses[featureKey]) {
        return next(forbidden('Feature not enabled for this account'));
      }
      req.featureLicenses = licenses;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { requireFeature };
