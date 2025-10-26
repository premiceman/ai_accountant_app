// backend/models/Job.js
const mongoose = require('mongoose');

const JobSchema = new mongoose.Schema({
  type:      { type: String, required: true },
  status:    { type: String, enum: ['pending','running','done','error'], default: 'pending', index: true },
  payload:   { type: mongoose.Schema.Types.Mixed, default: {} },
  result:    { type: mongoose.Schema.Types.Mixed, default: null },
  attempts:  { type: Number, default: 0 },
  error:     { type: String, default: null },
  workerId:  { type: String, default: null },
  lockedAt:  { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('Job', JobSchema);
