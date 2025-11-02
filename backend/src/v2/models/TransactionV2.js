const { mongoose } = require('./index');

const ProvenanceSchema = new mongoose.Schema({
  fileId: { type: String, required: true },
  page: { type: Number, required: true },
  anchor: { type: String, required: true },
}, { _id: false });

const TransactionV2Schema = new mongoose.Schema({
  userId: { type: String, index: true, required: true },
  transactionId: { type: String, required: true },
  fileId: { type: String, required: true },
  contentHash: { type: String, required: true },
  accountId: { type: String, required: true },
  date: { type: String, required: true },
  amount: { type: Number, required: true },
  currency: { type: String, required: true },
  description: { type: String, required: true },
  category: { type: String },
  subcategory: { type: String },
  counterparty: {
    type: {
      name: String,
      iban: String,
    },
    default: undefined,
  },
  balance: {
    type: {
      amount: Number,
      currency: String,
    },
    default: undefined,
  },
  provenance: { type: ProvenanceSchema, required: true },
  createdAt: { type: Date, default: Date.now },
}, {
  collection: 'transactions_v2',
});

TransactionV2Schema.index({ userId: 1, transactionId: 1 }, { unique: true });
TransactionV2Schema.index({ userId: 1, date: 1 });

module.exports = mongoose.model('TransactionV2', TransactionV2Schema);
