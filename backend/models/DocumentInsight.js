const mongoose = require('mongoose');

const METADATA_SCHEMA = new mongoose.Schema(
  {
    employerName: { type: String, default: null },
    institutionName: { type: String, default: null },
    rawInstitutionName: { type: String, default: null },
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
    accountType: { type: String, default: null },
    accountNumberMasked: { type: String, default: null },
    accountHolder: { type: String, default: null },
    nameMatchesUser: { type: Boolean, default: null },
    period: {
      start: { type: String, default: null },
      end: { type: String, default: null },
    },
  },
  { _id: false }
);

const DocumentInsightSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    fileId: { type: String, index: true, required: true },
    catalogueKey: {
      type: String,
      enum: [
        'payslip',
        'current_account_statement',
        'savings_account_statement',
        'isa_statement',
        'investment_statement',
        'pension_statement',
        'hmrc_correspondence',
      ],
      index: true,
      required: true,
    },
    baseKey: { type: String, index: true, required: true },
    schemaVersion: { type: String, required: true },
    parserVersion: { type: String, required: true },
    promptVersion: { type: String, required: true },
    model: { type: String, required: true },
    extractionSource: { type: String, enum: ['openai', 'heuristic'], default: 'openai' },
    confidence: { type: Number, default: null },
    contentHash: { type: String, index: true, required: true },
    documentDate: { type: String, default: null },
    documentMonth: { type: String, index: true, default: null },
    collectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'VaultCollection', default: null },
    metadata: { type: METADATA_SCHEMA, default: () => ({}) },
    metrics: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    transactions: { type: [mongoose.Schema.Types.Mixed], default: () => [] },
    narrative: { type: [String], default: () => [] },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
  }
);

DocumentInsightSchema.index({ userId: 1, catalogueKey: 1 });
DocumentInsightSchema.index({ userId: 1, 'metadata.institutionName': 1 });
DocumentInsightSchema.index({ userId: 1, 'metadata.employerName': 1 });
DocumentInsightSchema.index({ userId: 1, 'metadata.accountId': 1 });
DocumentInsightSchema.index({ userId: 1, documentMonth: 1 });
DocumentInsightSchema.index({ userId: 1, fileId: 1, schemaVersion: 1, contentHash: 1 }, { unique: true });

module.exports = mongoose.model('DocumentInsight', DocumentInsightSchema);
