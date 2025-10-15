const mongoose = require('mongoose');

const VaultDocumentJobSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    sessionId: { type: String, index: true, required: true },
    fileId: { type: String, index: true, required: true },
    originalName: { type: String, default: null },
    collectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'VaultCollection', default: null },

    classification: {
      type: new mongoose.Schema(
        {
          key: { type: String, default: null },
          label: { type: String, default: null },
          confidence: { type: Number, default: null },
          schemaId: { type: String, default: null },
        },
        { _id: false }
      ),
      default: () => ({}),
    },

    storage: {
      type: new mongoose.Schema(
        {
          pdfKey: { type: String, required: true },
          trimmedKey: { type: String, default: null },
          jsonKey: { type: String, default: null },
          size: { type: Number, default: null },
          contentHash: { type: String, default: null },
        },
        { _id: false }
      ),
      required: true,
    },

    docupipe: {
      type: new mongoose.Schema(
        {
          documentId: { type: String, default: null },
          parseJobId: { type: String, default: null },
          stdJobId: { type: String, default: null },
          standardizationId: { type: String, default: null },
          schemaId: { type: String, default: null },
          stdVersion: { type: String, default: null },
        },
        { _id: false }
      ),
      default: () => ({}),
    },

    state: {
      type: String,
      enum: ['queued', 'needs_trim', 'awaiting_manual_json', 'processing', 'completed', 'failed'],
      default: 'queued',
      index: true,
    },

    errors: {
      type: [
        new mongoose.Schema(
          {
            message: { type: String, default: null },
            code: { type: String, default: null },
            at: { type: Date, default: () => new Date() },
          },
          { _id: false }
        ),
      ],
      default: () => [],
    },

    requiresManualFields: { type: mongoose.Schema.Types.Mixed, default: null },

    trim: {
      type: new mongoose.Schema(
        {
          originalPageCount: { type: Number, default: null },
          keptPages: { type: [Number], default: () => [] },
          required: { type: Boolean, default: false },
          reviewedAt: { type: Date, default: null },
        },
        { _id: false }
      ),
      default: () => ({}),
    },

    audit: {
      type: [
        new mongoose.Schema(
          {
            state: { type: String, default: null },
            at: { type: Date, default: () => new Date() },
            note: { type: String, default: null },
          },
          { _id: false }
        ),
      ],
      default: () => [],
    },

    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

VaultDocumentJobSchema.index({ userId: 1, sessionId: 1 });
VaultDocumentJobSchema.index({ userId: 1, state: 1 });

module.exports = mongoose.model('VaultDocumentJob', VaultDocumentJobSchema);
