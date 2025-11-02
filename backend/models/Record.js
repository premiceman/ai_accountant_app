const mongoose = require('mongoose');

const IntegritySchema = new mongoose.Schema(
  {
    status: { type: String, enum: ['pass', 'fail'], default: 'pass' },
    reason: { type: String, default: null },
    delta: { type: Number, default: null },
  },
  { _id: false }
);

const RecordSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'VaultDocument', required: true, index: true },
    type: { type: String, enum: ['payslip', 'bankStatement', 'unknown'], required: true },
    normalized: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    integrity: { type: IntegritySchema, default: () => ({ status: 'pass' }) },
  },
  {
    collection: 'records',
    timestamps: { createdAt: true, updatedAt: false },
  }
);

RecordSchema.index({ userId: 1, documentId: 1 }, { unique: true });

module.exports = mongoose.model('Record', RecordSchema);
