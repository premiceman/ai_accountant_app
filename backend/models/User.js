// backend/models/User.js
const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  email:       { type: String, required: true, unique: true, index: true },
  passwordHash:{ type: String, required: true },
  firstName:   { type: String },
  lastName:    { type: String },

  // ✅ Allow both 'professional' and legacy 'premium'
  licenseTier: {
    type: String,
    enum: ['free', 'basic', 'professional', 'premium'],
    default: 'free',
    index: true
  },

  // any other fields you already have…
}, { timestamps: true });

/** Canonicalise legacy values on save (no behavior removal) */
UserSchema.pre('save', function(next) {
  if (this.licenseTier === 'premium') this.licenseTier = 'professional';
  next();
});

module.exports = mongoose.model('User', UserSchema);


