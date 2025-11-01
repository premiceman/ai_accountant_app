'use strict';

const mongoose = require('mongoose');

const StepSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    status: { type: String, default: 'pending' },
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    message: { type: String, default: null },
  },
  { _id: false }
);

const VaultJobSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'VaultDocument', required: true },
    type: { type: String, enum: ['docupipe'], required: true },
    status: { type: String, enum: ['queued', 'running', 'completed', 'failed'], default: 'queued' },
    steps: { type: [StepSchema], default: () => [] },
    error: { type: String, default: null },
  },
  {
    collection: 'jobs',
    timestamps: true,
  }
);

VaultJobSchema.index({ userId: 1, documentId: 1, createdAt: -1 });

module.exports = mongoose.models.VaultJob || mongoose.model('VaultJob', VaultJobSchema);
