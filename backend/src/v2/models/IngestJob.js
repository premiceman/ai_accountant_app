const { mongoose } = require('./index');

const IngestJobSchema = new mongoose.Schema({
  userId: { type: String, index: true, required: true },
  jobId: { type: String, unique: true, required: true },
  batchId: { type: String, required: true },
  fileId: { type: String, required: true },
  r2Key: { type: String, required: true },
  typeHint: { type: String },
  status: { type: String, default: 'queued' },
  contentHash: { type: String },
  attempts: { type: Number, default: 0 },
  lastError: { type: Object, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, {
  collection: 'ingest_jobs_v2',
});

IngestJobSchema.index({ userId: 1, fileId: 1 });

module.exports = mongoose.model('IngestJob', IngestJobSchema);
