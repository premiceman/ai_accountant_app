import mongoose, { Schema, type InferSchemaType, type Model, Types } from 'mongoose';

const DocupipeSchema = new Schema(
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
);

const PiiSchema = new Schema(
  {
    accountLast4: { type: String, default: null },
    niLast3: { type: String, default: null },
  },
  { _id: false }
);

const DeletionSchema = new Schema(
  {
    requestedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { _id: false }
);

const VaultDocumentSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
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
    docupipe: { type: DocupipeSchema, default: () => ({}) },
    pii: { type: PiiSchema, default: () => ({}) },
    deletion: { type: DeletionSchema, default: () => ({}) },
  },
  {
    collection: 'documents',
    timestamps: true,
  }
);

VaultDocumentSchema.index({ userId: 1, uploadedAt: -1 });

export type VaultDocument = InferSchemaType<typeof VaultDocumentSchema> & { _id: Types.ObjectId };
export type VaultDocumentModel = Model<VaultDocument>;

export const VaultDocumentModel: VaultDocumentModel =
  (mongoose.models.VaultDocument as VaultDocumentModel) ||
  mongoose.model<VaultDocument>('VaultDocument', VaultDocumentSchema);
