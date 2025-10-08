import mongoose, { Schema, InferSchemaType, Model } from 'mongoose';

const UserOverrideSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    scope: { type: String, enum: ['transaction', 'metric'], required: true },
    targetId: { type: String, required: true },
    patch: { type: Schema.Types.Mixed, required: true },
    note: { type: String, default: null },
    appliesFrom: { type: String, required: true },
    createdAt: { type: Date, default: () => new Date() },
    updatedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

UserOverrideSchema.index({ userId: 1, scope: 1, targetId: 1 });

export type UserOverride = InferSchemaType<typeof UserOverrideSchema>;
export type UserOverrideModel = Model<UserOverride>;

export const UserOverrideModel: UserOverrideModel =
  (mongoose.models.UserOverride as UserOverrideModel) ||
  mongoose.model<UserOverride>('UserOverride', UserOverrideSchema);
