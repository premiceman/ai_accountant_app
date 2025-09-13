// backend/models/User.js
const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  email:        { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
  username:     { type: String, trim: true, unique: true, sparse: true, index: true }, // optional but supported
  passwordHash: { type: String, required: true },

  firstName:    { type: String, trim: true },
  lastName:     { type: String, trim: true },

  // Accept both for backward compatibility; present 'premium' to the client
  licenseTier: {
    type: String,
    enum: ['free', 'basic', 'premium', 'professional'],
    default: 'free',
    index: true
  }
}, { timestamps: true });

// Normalise legacy values on save: map 'professional' -> 'premium'
UserSchema.pre('save', function(next) {
  if (this.licenseTier === 'professional') this.licenseTier = 'premium';
  next();
});

module.exports = mongoose.model('User', UserSchema);


