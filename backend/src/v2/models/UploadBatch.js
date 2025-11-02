const { mongoose } = require('./index');

const ChildSchema = new mongoose.Schema({
  fileId: { type: String, required: true },
  filename: { type: String, required: true },
  status: { type: String, required: true },
  message: { type: String },
  r2Key: { type: String },
  updatedAt: { type: Date, default: Date.now },
}, { _id: false });

const FileSchema = new mongoose.Schema({
  fileId: { type: String, required: true },
  filename: { type: String, required: true },
  contentType: { type: String, required: true },
  size: { type: Number, required: true },
  typeHint: { type: String },
  status: { type: String, default: 'pending' },
  message: { type: String },
  r2Key: { type: String },
  contentHash: { type: String },
  updatedAt: { type: Date, default: Date.now },
  children: { type: [ChildSchema], default: [] },
}, { _id: false });

const UploadBatchSchema = new mongoose.Schema({
  userId: { type: String, index: true, required: true },
  batchId: { type: String, unique: true, required: true },
  createdAt: { type: Date, default: Date.now },
  status: { type: String, default: 'pending' },
  files: { type: [FileSchema], default: [] },
  summary: {
    type: {
      processed: Number,
      failed: Number,
      skipped: Number,
    },
    default: undefined,
  },
}, {
  collection: 'upload_batches',
});

module.exports = mongoose.model('UploadBatch', UploadBatchSchema);
