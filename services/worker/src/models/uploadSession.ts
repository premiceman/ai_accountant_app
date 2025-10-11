import mongoose, { Schema, InferSchemaType, Model } from 'mongoose';

const FileSchema = new Schema(
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
);

const UploadSessionSchema = new Schema(
  {
    sessionId: { type: String, index: true, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    files: { type: [FileSchema], default: () => [] },
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

export type UploadSession = InferSchemaType<typeof UploadSessionSchema>;
export type UploadSessionModel = Model<UploadSession>;

export const UploadSessionModel: UploadSessionModel =
  (mongoose.models.UploadSession as UploadSessionModel) ||
  mongoose.model<UploadSession>('UploadSession', UploadSessionSchema);
