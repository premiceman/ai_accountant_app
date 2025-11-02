const { mongoose } = require('./index');

const ProvenanceSchema = new mongoose.Schema({
  fileId: { type: String, required: true },
  page: { type: Number, required: true },
  anchor: { type: String, required: true },
}, { _id: false });

const AccountV2Schema = new mongoose.Schema({
  userId: { type: String, index: true, required: true },
  accountId: { type: String, required: true },
  fileId: { type: String, required: true },
  contentHash: { type: String, required: true },
  name: { type: String },
  currency: { type: String, required: true },
  sortCode: { type: String },
  accountNumber: { type: String },
  provenance: { type: ProvenanceSchema, required: true },
  createdAt: { type: Date, default: Date.now },
}, {
  collection: 'accounts_v2',
});

AccountV2Schema.index({ userId: 1, accountId: 1 }, { unique: true });

module.exports = mongoose.model('AccountV2', AccountV2Schema);
