import mongoose, { Schema, InferSchemaType, Model } from 'mongoose';

const LastErrorSchema = new Schema(
  {
    code: { type: String, default: null },
    message: { type: String, default: null },
  },
  { _id: false }
);

const UserDocumentJobSchema = new Schema(
  {
    jobId: { type: String, index: true, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    sessionId: { type: String, default: null },
    collectionId: { type: Schema.Types.ObjectId, ref: 'VaultCollection', default: null },
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
    retryAt: { type: Date, default: () => new Date() },
    lastError: { type: LastErrorSchema, default: null },
    lastUpdatePlanSummary: { type: String, default: null },
    lastCompletedUpdateKey: { type: String, default: null },
    schemaVersion: { type: String, required: true },
    parserVersion: { type: String, required: true },
    promptVersion: { type: String, required: true },
    model: { type: String, required: true },
  },
  { timestamps: true }
);

UserDocumentJobSchema.index({ status: 1, createdAt: 1 });
UserDocumentJobSchema.index({ userId: 1, fileId: 1 });

export type UserDocumentJob = InferSchemaType<typeof UserDocumentJobSchema>;
export type UserDocumentJobModel = Model<UserDocumentJob>;

export const UserDocumentJobModel: UserDocumentJobModel =
  (mongoose.models.UserDocumentJob as UserDocumentJobModel) ||
  mongoose.model<UserDocumentJob>('UserDocumentJob', UserDocumentJobSchema);
