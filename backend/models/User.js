const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  firstName: { type: String, required: true, trim: true, maxlength: 60 },
  lastName:  { type: String, required: true, trim: true, maxlength: 60 },
  username:  { type: String, trim: true, maxlength: 60, index: true, unique: true, sparse: true },
  email:     { type: String, required: true, trim: true, lowercase: true, unique: true, index: true, maxlength: 120 },
  password:  { type: String, required: true },
  phone:     { type: String, trim: true, maxlength: 30 },
  address:   { type: String, trim: true, maxlength: 200 },
  role:      { type: String, default: 'user' }
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);
