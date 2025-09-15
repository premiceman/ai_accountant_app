// backend/models/User.js
const mongoose = require('mongoose');
const crypto = require('crypto');

function generateUid() {
  const rand = crypto.randomBytes(12).toString('base64url');
  return 'u_' + rand.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

const UserSchema = new mongoose.Schema({
  firstName: { type: String, trim: true, required: true },
  lastName:  { type: String, trim: true, required: true },
  username:  { type: String, trim: true }, // no unique index (we validate at app level)
  email:     { type: String, trim: true, unique: true, required: true },
  password:  { type: String, required: true },

  // New: DOB (required)
  dateOfBirth: { type: Date, required: true },

  // Permanent cross-link id
  uid:       { type: String, unique: true, index: true, default: generateUid },

  // Existing optional fields
  licenseTier:   { type: String, enum: ['free','basic','premium'], default: 'free' },
  eulaAcceptedAt:{ type: Date, default: null },
  eulaVersion:   { type: String, default: null }
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);
