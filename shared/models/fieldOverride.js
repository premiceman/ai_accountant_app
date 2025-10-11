const mongoose = require('mongoose');

const SelectorStrategySchema = new mongoose.Schema(
  {
    regex: { type: String, default: null },
    anchorLabel: { type: String, default: null },
    lineRange: { type: Number, default: null },
    columnHint: { type: String, default: null },
    tokenizer: { type: String, default: null },
    hints: { type: [String], default: () => [] },
  },
  { _id: false }
);

const FieldOverrideSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, index: true, required: true },
    docType: { type: String, index: true, required: true },
    fieldKey: { type: String, index: true, required: true },
    dataType: {
      type: String,
      enum: ['number', 'integer', 'string', 'dateMMYYYY'],
      required: true,
    },
    selectorStrategy: { type: SelectorStrategySchema, default: () => ({}) },
    sampleValue: { type: mongoose.Schema.Types.Mixed, default: null },
    enabled: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

FieldOverrideSchema.index({ userId: 1, docType: 1, fieldKey: 1 }, { unique: true });

module.exports = mongoose.models.FieldOverride || mongoose.model('FieldOverride', FieldOverrideSchema);
