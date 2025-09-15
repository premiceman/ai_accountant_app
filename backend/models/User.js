// backend/models/User.js
const mongoose = require('mongoose');
const crypto = require('crypto');

function generateUid() {
  // Compact, URL-safe id (e.g., "u_jf2k3p9m4q6")
  const rand = crypto.randomBytes(12).toString('base64url');
  return 'u_' + rand.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

const UserSchema = new mongoose.Schema({
  firstName: { type: String, trim: true },
  lastName:  { type: String, trim: true },
  username:  { type: String, trim: true, unique: false, sparse: true },
  email:     { type: String, trim: true, unique: true, required: true },
  password:  { type: String, required: true },

  // New: permanent unique identifier for cross-linking documents/events
  uid:       { type: String, unique: true, index: true, default: generateUid },

  // Existing optional fields
  licenseTier:   { type: String, enum: ['free','basic','premium'], default: 'free' },
  eulaAcceptedAt:{ type: Date, default: null },
  eulaVersion:   { type: String, default: null }
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);
