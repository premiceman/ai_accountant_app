const { mongoose } = require('./index');

const DocumentSourceSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    sourceId: { type: String, required: true, unique: true },
    type: { type: String, enum: ['payslip', 'statement'], required: true },
    name: { type: String, required: true },
    institutionName: { type: String, default: null },
    accountNumber: { type: String, default: null },
    metadata: { type: Object, default: () => ({}) },
  },
  { timestamps: true }
);

DocumentSourceSchema.index({ userId: 1, type: 1, name: 1 });

module.exports = mongoose.model('DocumentSource', DocumentSourceSchema);
