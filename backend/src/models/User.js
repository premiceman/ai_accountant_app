// backend/src/models/User.js
const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, index: true },
  username: { type: String, index: true },
  firstName: String,
  lastName: String,
  role: { type: String, default: 'user' },
  password: { type: String, required: true }, // bcrypt hash or plaintext in dev
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);
