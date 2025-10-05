// backend/models/PlaidItem.js
const mongoose = require('mongoose');

const { Schema } = mongoose;

const AccessTokenSchema = new Schema({
  data: { type: String, required: true },
  iv: { type: String },
  tag: { type: String },
  plain: { type: Boolean, default: false },
}, { _id: false });

const PlaidItemSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  plaidItemId: { type: String, required: true, index: true },
  accessToken: { type: AccessTokenSchema, required: true },
  institution: { type: Schema.Types.Mixed, default: {} },
  accounts: { type: [Schema.Types.Mixed], default: [] },
  status: { type: Schema.Types.Mixed, default: {} },
  consentExpirationTime: { type: Date },
  lastSuccessfulUpdate: { type: Date },
  lastFailedUpdate: { type: Date },
  lastSyncAttempt: { type: Date },
  lastSyncedAt: { type: Date },
}, { timestamps: true });

PlaidItemSchema.index({ userId: 1, plaidItemId: 1 }, { unique: true });

module.exports = mongoose.models.PlaidItem || mongoose.model('PlaidItem', PlaidItemSchema);
