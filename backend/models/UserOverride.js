const mongoose = require('mongoose');

const UserOverrideSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    scope: { type: String, enum: ['transaction', 'metric'], required: true },
    targetId: { type: String, required: true },
    patch: { type: mongoose.Schema.Types.Mixed, required: true },
    note: { type: String, default: null },
    appliesFrom: { type: String, required: true },
    createdAt: { type: Date, default: () => new Date() },
    updatedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

UserOverrideSchema.index({ userId: 1, scope: 1, targetId: 1 });

module.exports = mongoose.model('UserOverride', UserOverrideSchema);
