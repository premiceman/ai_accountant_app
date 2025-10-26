// backend/models/AuditLog.js
const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema({
  actorId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  action:     { type: String, required: true },
  targetType: { type: String, required: true },
  targetId:   { type: String, required: true },
  metadata:   { type: mongoose.Schema.Types.Mixed, default: {} },
  ip:         { type: String, default: null },
  ua:         { type: String, default: null },
  ts:         { type: Date, default: Date.now }
}, { timestamps: false });

module.exports = mongoose.model('AuditLog', AuditLogSchema);
