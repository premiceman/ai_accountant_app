const { mongoose } = require('./index');

const DocumentResultSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, index: true },
    fileUrl: { type: String },
    filename: { type: String },
    uploadJobId: { type: String, index: true },
    standardizationJobId: { type: String, index: true, sparse: true },
    standardizationId: { type: String, index: true, sparse: true },
    documentId: { type: String, index: true, sparse: true },
    schemaId: { type: String, index: true, sparse: true },
    schemaName: { type: String, default: null },
    type: { type: String, default: 'unknown' },
    initialResponse: mongoose.Schema.Types.Mixed,
    finalJob: mongoose.Schema.Types.Mixed,
    standardization: mongoose.Schema.Types.Mixed,
    status: {
      type: String,
      enum: ['queued', 'running', 'completed', 'failed'],
      default: 'queued',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('DocumentResult', DocumentResultSchema);
