const { mongoose } = require('./index');

const UploadedDocumentSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    fileId: { type: String, required: true },
    docType: { type: String, enum: ['payslip', 'statement'], required: true },
    month: { type: String, required: true, index: true },
    periodStart: { type: String, default: null },
    periodEnd: { type: String, default: null },
    payDate: { type: String, default: null },
    contentHash: { type: String, required: true },
    r2Key: { type: String, required: true },
    originalName: { type: String, default: null },
    contentType: { type: String, default: null },
    size: { type: Number, default: null },
    metadata: { type: Object, default: () => ({}) },
    analytics: { type: Object, default: () => ({}) },
    transactions: { type: [Object], default: () => [] },
    docupipe: { type: Object, default: () => ({}) },
    raw: { type: Object, default: () => ({}) },
  },
  {
    timestamps: true,
    minimize: false,
  }
);

UploadedDocumentSchema.index({ userId: 1, fileId: 1 }, { unique: true });
UploadedDocumentSchema.index({ userId: 1, contentHash: 1 }, { unique: true });
UploadedDocumentSchema.index({ userId: 1, docType: 1, month: 1 });

module.exports = mongoose.model('UploadedDocument', UploadedDocumentSchema);
