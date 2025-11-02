import mongoose, { Schema, type InferSchemaType, type Model, Types } from 'mongoose';

const CATEGORY_VALUES = [
  'Housing',
  'Utilities',
  'Groceries',
  'Transport',
  'Subscriptions',
  'Leisure',
  'Fees/Charges',
  'Income',
  'Refunds',
  'Savings/Transfers',
  'Other',
] as const;

const TransactionCategoryCacheSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    merchantHash: { type: String, required: true },
    category: { type: String, enum: CATEGORY_VALUES, required: true },
    descriptionSample: { type: String, default: null },
    lastAmountMinor: { type: Number, default: null },
    lastDirection: { type: String, enum: ['inflow', 'outflow'], default: null },
  },
  { timestamps: true }
);

TransactionCategoryCacheSchema.index({ userId: 1, merchantHash: 1 }, { unique: true });

export type TransactionCategoryCache = InferSchemaType<typeof TransactionCategoryCacheSchema> & {
  _id: Types.ObjectId;
};

export type TransactionCategoryCacheModel = Model<TransactionCategoryCache>;

export const TransactionCategoryCacheModel: TransactionCategoryCacheModel =
  (mongoose.models.TransactionCategoryCache as TransactionCategoryCacheModel) ||
  mongoose.model<TransactionCategoryCache>('TransactionCategoryCache', TransactionCategoryCacheSchema);

export const TRANSACTION_CATEGORY_VALUES = CATEGORY_VALUES;
