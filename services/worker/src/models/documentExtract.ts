import mongoose, { Schema, type InferSchemaType, type Model, Types } from 'mongoose';

const DocupipeExtractSchema = new Schema(
  {
    documentId: { type: String, required: true },
    raw: { type: Schema.Types.Mixed, required: true },
  },
  { _id: false }
);

const DocumentExtractSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    documentId: { type: Schema.Types.ObjectId, ref: 'VaultDocument', required: true, index: true },
    type: { type: String, enum: ['payslip', 'bankStatement', 'unknown'], default: 'unknown' },
    docupipe: { type: DocupipeExtractSchema, required: true },
  },
  {
    collection: 'extracts',
    timestamps: { createdAt: true, updatedAt: false },
  }
);

DocumentExtractSchema.index({ userId: 1, documentId: 1 }, { unique: true });

export type DocumentExtract = InferSchemaType<typeof DocumentExtractSchema> & { _id: Types.ObjectId };
export type DocumentExtractModel = Model<DocumentExtract>;

export const DocumentExtractModel: DocumentExtractModel =
  (mongoose.models.DocumentExtract as DocumentExtractModel) ||
  mongoose.model<DocumentExtract>('DocumentExtract', DocumentExtractSchema);
