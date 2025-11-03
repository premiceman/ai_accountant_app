const { mongoose } = require('./index');

const ProvenanceSchema = new mongoose.Schema({
  fileId: { type: String, required: true },
  page: { type: Number, required: true },
  anchor: { type: String, required: true },
}, { _id: false });

const DocumentInsightSchema = new mongoose.Schema({
  userId: { type: String, index: true, required: true },
  fileId: { type: String, required: true },
  batchId: { type: String, required: true },
  docType: { type: String, required: true },
  contentHash: { type: String, required: true },
  sourceKey: { type: String, required: true },
  canonical: { type: Object, required: true },
  docupipeRaw: { type: Object, default: null },
  lineage: {
    type: [{ path: String, provenance: ProvenanceSchema }],
    default: [],
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, {
  collection: 'document_insights',
});

DocumentInsightSchema.index({ userId: 1, fileId: 1 }, { unique: true });
DocumentInsightSchema.index({ userId: 1, contentHash: 1 });

module.exports = mongoose.model('DocumentInsight', DocumentInsightSchema);
