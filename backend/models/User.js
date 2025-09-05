// backend/models/User.js
const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  firstName: { type: String, trim: true },
  lastName:  { type: String, trim: true },
  username:  { type: String, trim: true, unique: false, sparse: true },
  email:     { type: String, trim: true, unique: true, required: true },
  password:  { type: String, required: true },

  // New optional fields
  licenseTier:   { type: String, enum: ['free','basic','premium'], default: 'free' },
  eulaAcceptedAt:{ type: Date, default: null },
  eulaVersion:   { type: String, default: null }
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);

