// backend/models/Transaction.js
const mongoose = require('mongoose');

const { Schema } = mongoose;

const TransactionSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', index: true, required: true },
  itemId: { type: Schema.Types.ObjectId, ref: 'PlaidItem', index: true, required: true },
  plaidItemId: { type: String, index: true, required: true },
  plaidAccountId: { type: String, index: true },
  plaidTransactionId: { type: String, index: true },
  name: { type: String },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'GBP' },
  date: { type: Date, required: true },
  pending: { type: Boolean, default: false },
  categories: { type: [String], default: [] },
  merchantName: { type: String },
  raw: { type: Schema.Types.Mixed },
  removedAt: { type: Date },
}, { timestamps: true });

TransactionSchema.index({ userId: 1, plaidTransactionId: 1 }, { unique: true, sparse: true });
TransactionSchema.index({ itemId: 1, date: -1 });

module.exports = mongoose.models.Transaction || mongoose.model('Transaction', TransactionSchema);
