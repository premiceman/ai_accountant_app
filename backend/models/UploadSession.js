const mongoose = require('mongoose');

const UploadSessionSchema = new mongoose.Schema(
  {
    sessionId: { type: String, index: true, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    files: {
      type: [
        new mongoose.Schema(
          {
            fileId: { type: String, required: true },
            originalName: { type: String, required: true },
            status: {
              type: String,
              enum: ['uploaded', 'processing', 'done', 'rejected'],
              default: 'uploaded',
            },
            reason: { type: String, default: null },
          },
          { _id: false }
        ),
      ],
      default: () => [],
    },
    summary: {
      total: { type: Number, default: 0 },
      accepted: { type: Number, default: 0 },
      rejected: { type: Number, default: 0 },
    },
    createdAt: { type: Date, default: () => new Date() },
    updatedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

UploadSessionSchema.index({ sessionId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('UploadSession', UploadSessionSchema);
