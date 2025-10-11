const mongoose = require('mongoose');

const DocumentSchematicSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    docType: { type: String, index: true, required: true },
    name: { type: String, required: true },
    version: { type: String, index: true, default: null },
    status: {
      type: String,
      enum: ['draft', 'active', 'archived'],
      default: 'draft',
      index: true,
    },
    rules: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    fingerprint: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

DocumentSchematicSchema.index(
  { userId: 1, docType: 1, name: 1, version: 1 },
  { unique: true, partialFilterExpression: { version: { $type: 'string' } } }
);

const DocumentSchematic = mongoose.model('DocumentSchematic', DocumentSchematicSchema);

module.exports = DocumentSchematic;
