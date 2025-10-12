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
    builderMetadata: {
      type: new mongoose.Schema(
        {
          sessionId: { type: String, default: null },
          samples: {
            type: [
              new mongoose.Schema(
                {
                  id: { type: String, default: null },
                  name: { type: String, default: null },
                  size: { type: Number, default: null },
                  mimeType: { type: String, default: null },
                  uploadedAt: { type: Date, default: null },
                  storagePath: { type: String, default: null },
                  notes: { type: String, default: '' },
                },
                { _id: false }
              ),
            ],
            default: () => [],
          },
          colourPalette: {
            type: new mongoose.Schema(
              {
                primary: { type: String, default: null },
                secondary: { type: String, default: null },
                accent: { type: String, default: null },
                background: { type: String, default: null },
                text: { type: String, default: null },
              },
              { _id: false }
            ),
            default: null,
          },
          columnTemplates: {
            type: [
              new mongoose.Schema(
                {
                  name: { type: String, default: null },
                  description: { type: String, default: '' },
                  fields: { type: [String], default: () => [] },
                },
                { _id: false }
              ),
            ],
            default: () => [],
          },
          fieldMappings: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
          notes: { type: String, default: '' },
        },
        { _id: false }
      ),
      default: () => ({
        sessionId: null,
        samples: [],
        colourPalette: null,
        columnTemplates: [],
        fieldMappings: {},
        notes: '',
      }),
    },
  },
  { timestamps: true }
);

DocumentSchematicSchema.index(
  { userId: 1, docType: 1, name: 1, version: 1 },
  { unique: true, partialFilterExpression: { version: { $type: 'string' } } }
);

const DocumentSchematic = mongoose.model('DocumentSchematic', DocumentSchematicSchema);

module.exports = DocumentSchematic;
