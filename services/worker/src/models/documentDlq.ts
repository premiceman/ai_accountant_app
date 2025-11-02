import mongoose, { Schema, type InferSchemaType, type Model, Types } from 'mongoose';

const DocumentDlqSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    documentId: { type: Schema.Types.ObjectId, ref: 'VaultDocument', required: true, index: true },
    reason: {
      type: String,
      enum: ['net_identity_failed', 'balance_mismatch', 'docupipe_timeout', 'docupipe_error'],
      required: true,
    },
    details: { type: Schema.Types.Mixed, default: null },
  },
  {
    collection: 'document_dlq',
    timestamps: { createdAt: true, updatedAt: false },
  }
);

DocumentDlqSchema.index({ userId: 1, documentId: 1 });

export type DocumentDlq = InferSchemaType<typeof DocumentDlqSchema> & { _id: Types.ObjectId };
export type DocumentDlqModel = Model<DocumentDlq>;

export const DocumentDlqModel: DocumentDlqModel =
  (mongoose.models.DocumentDlq as DocumentDlqModel) ||
  mongoose.model<DocumentDlq>('DocumentDlq', DocumentDlqSchema);
