const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  firstName: { type: String, required: true, trim: true, maxlength: 60 },
  lastName:  { type: String, required: true, trim: true, maxlength: 60 },
  username:  { type: String, trim: true, maxlength: 60 },
  email:     { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 120 },
  password:  { type: String, required: true },
  phone:     { type: String, trim: true, maxlength: 30 },
  address:   { type: String, trim: true, maxlength: 200 },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
