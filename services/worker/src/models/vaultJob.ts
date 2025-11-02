import mongoose, { Schema, type InferSchemaType, type Model, Types } from 'mongoose';

const StepSchema = new Schema(
  {
    name: { type: String, required: true },
    status: { type: String, default: 'pending' },
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    message: { type: String, default: null },
  },
  { _id: false }
);

const VaultJobSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    documentId: { type: Schema.Types.ObjectId, ref: 'VaultDocument', required: true },
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

export type VaultJob = InferSchemaType<typeof VaultJobSchema> & { _id: Types.ObjectId };
export type VaultJobModel = Model<VaultJob>;

export const VaultJobModel: VaultJobModel =
  (mongoose.models.VaultJob as VaultJobModel) || mongoose.model<VaultJob>('VaultJob', VaultJobSchema);
