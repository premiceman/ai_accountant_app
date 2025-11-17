const User = require('../models/User');

const EDITABLE_FIELDS = ['firstName', 'lastName', 'country', 'profileInterests'];

async function getProfile(userId) {
  const user = await User.findById(userId).lean();
  if (!user) return null;
  return {
    id: String(user._id),
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    country: user.country,
    profileInterests: user.profileInterests,
    licenseTier: user.licenseTier,
    featureLicenses: user.featureLicenses || {},
  };
}

async function updateProfile(userId, payload) {
  const updates = {};
  for (const field of EDITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      updates[field] = payload[field];
    }
  }
  if (!Object.keys(updates).length) {
    return getProfile(userId);
  }
  await User.findByIdAndUpdate(userId, updates, { runValidators: true });
  return getProfile(userId);
}

module.exports = { getProfile, updateProfile };
