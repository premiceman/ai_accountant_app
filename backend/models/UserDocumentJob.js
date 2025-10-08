const mongoose = require('mongoose');

const LastErrorSchema = new mongoose.Schema(
  {
    code: { type: String, default: null },
    message: { type: String, default: null },
  },
  { _id: false }
);

const UserDocumentJobSchema = new mongoose.Schema(
  {
    jobId: { type: String, index: true, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    sessionId: { type: String, default: null },
    collectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'VaultCollection', default: null },
    fileId: { type: String, index: true, required: true },
    originalName: { type: String, required: true },
    contentHash: { type: String, required: true },
    candidateType: { type: String, default: null },
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'succeeded', 'failed', 'rejected', 'dead_letter'],
      default: 'pending',
      index: true,
    },
    uploadState: {
      type: String,
      enum: ['pending', 'in_progress', 'succeeded', 'failed'],
      default: 'pending',
    },
    processState: {
      type: String,
      enum: ['pending', 'in_progress', 'succeeded', 'failed'],
      default: 'pending',
    },
    attempts: { type: Number, default: 0 },
    lastError: { type: LastErrorSchema, default: null },
    schemaVersion: { type: String, required: true },
    parserVersion: { type: String, required: true },
    promptVersion: { type: String, required: true },
    model: { type: String, required: true },
  },
  { timestamps: true }
);

UserDocumentJobSchema.index({ status: 1, createdAt: 1 });
UserDocumentJobSchema.index({ userId: 1, fileId: 1 });

module.exports = mongoose.model('UserDocumentJob', UserDocumentJobSchema);
