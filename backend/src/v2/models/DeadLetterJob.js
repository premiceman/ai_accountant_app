const { mongoose } = require('./index');

const DeadLetterJobSchema = new mongoose.Schema({
  userId: { type: String, index: true, required: true },
  fileId: { type: String, required: true },
  jobId: { type: String, required: true },
  stage: { type: String, required: true },
  reason: { type: String, required: true },
  diagnostics: { type: Object, default: {} },
  createdAt: { type: Date, default: Date.now },
}, {
  collection: 'dead_letter_jobs',
});

DeadLetterJobSchema.index({ userId: 1, jobId: 1 }, { unique: true });

module.exports = mongoose.model('DeadLetterJob', DeadLetterJobSchema);
