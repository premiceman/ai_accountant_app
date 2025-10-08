import mongoose, { Schema, InferSchemaType, Model } from 'mongoose';

const AccountSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    institutionName: { type: String, required: true },
    rawInstitutionNames: { type: [String], default: () => [] },
    accountType: {
      type: String,
      enum: ['Current', 'Savings', 'ISA', 'Investments', 'Pension'],
      required: true,
    },
    accountNumberMasked: { type: String, required: true },
    displayName: { type: String, required: true },
    fingerprints: { type: [String], default: () => [] },
    firstSeenAt: { type: Date, default: () => new Date() },
    lastSeenAt: { type: Date, default: () => new Date() },
    closed: { type: Boolean, default: false },
  },
  { timestamps: true }
);

AccountSchema.index(
  { userId: 1, institutionName: 1, accountNumberMasked: 1, accountType: 1 },
  { unique: true }
);

export type Account = InferSchemaType<typeof AccountSchema>;
export type AccountModel = Model<Account>;

export const AccountModel: AccountModel =
  (mongoose.models.Account as AccountModel) ||
  mongoose.model<Account>('Account', AccountSchema);
