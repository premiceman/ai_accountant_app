'use strict';

const mongoose = require('mongoose');

const VaultDocumentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    r2Key: { type: String, required: true },
    filename: { type: String, required: true },
    fileSize: { type: Number, required: true },
    fileType: { type: String, required: true },
    uploadedAt: { type: Date, default: () => new Date() },
    status: {
      type: String,
      enum: ['uploaded', 'processing', 'ready', 'failed'],
      default: 'uploaded',
    },
    docupipe: {
      type: new mongoose.Schema(
        {
          documentId: { type: String, default: null },
          workflowId: { type: String, default: null },
          runId: { type: String, default: null },
          jobId: { type: String, default: null },
          status: { type: String, default: null },
          submittedAt: { type: Date, default: null },
          completedAt: { type: Date, default: null },
          lastPolledAt: { type: Date, default: null },
        },
        { _id: false }
      ),
      default: () => ({}),
    },
    pii: {
      type: new mongoose.Schema(
        {
          accountLast4: { type: String, default: null },
          niLast3: { type: String, default: null },
        },
        { _id: false }
      ),
      default: () => ({}),
    },
    deletion: {
      type: new mongoose.Schema(
        {
          requestedAt: { type: Date, default: null },
          deletedAt: { type: Date, default: null },
        },
        { _id: false }
      ),
      default: () => ({}),
    },
  },
  {
    collection: 'documents',
    timestamps: true,
  }
);

VaultDocumentSchema.index({ userId: 1, uploadedAt: -1 });

module.exports = mongoose.models.VaultDocument || mongoose.model('VaultDocument', VaultDocumentSchema);
