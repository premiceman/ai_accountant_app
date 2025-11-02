import mongoose, { Schema, type InferSchemaType, type Model, Types } from 'mongoose';

const IntegritySchema = new Schema(
  {
    status: { type: String, enum: ['pass', 'fail'], required: true },
    reason: { type: String, default: null },
    delta: { type: Number, default: null },
  },
  { _id: false }
);

const DocumentRecordSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    documentId: { type: Schema.Types.ObjectId, ref: 'VaultDocument', required: true, index: true },
    type: { type: String, enum: ['payslip', 'bankStatement', 'unknown'], required: true },
    normalized: { type: Schema.Types.Mixed, required: true },
    integrity: { type: IntegritySchema, required: true },
  },
  {
    collection: 'records',
    timestamps: { createdAt: true, updatedAt: false },
  }
);

DocumentRecordSchema.index({ userId: 1, documentId: 1 }, { unique: true });

export type DocumentRecord = InferSchemaType<typeof DocumentRecordSchema> & { _id: Types.ObjectId };
export type DocumentRecordModel = Model<DocumentRecord>;

export const DocumentRecordModel: DocumentRecordModel =
  (mongoose.models.DocumentRecord as DocumentRecordModel) ||
  mongoose.model<DocumentRecord>('DocumentRecord', DocumentRecordSchema);
