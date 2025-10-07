const mongoose = require('mongoose');

const DocumentInsightSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
  fileId: { type: String, index: true, required: true },
  catalogueKey: { type: String, index: true, required: true },
  baseKey: { type: String, index: true, required: true },
  documentMonth: { type: String, index: true, default: null },
  documentDate: { type: Date, default: null },
  documentLabel: { type: String, default: null },
  documentName: { type: String, default: null },
  nameMatchesUser: { type: Boolean, default: null },
  extractedAt: { type: Date, default: Date.now },
  metrics: { type: mongoose.Schema.Types.Mixed, default: {} },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  transactions: { type: [mongoose.Schema.Types.Mixed], default: [] },
  narrative: { type: [String], default: [] },
}, { timestamps: true });

DocumentInsightSchema.index({ userId: 1, catalogueKey: 1, documentMonth: 1 });
DocumentInsightSchema.index({ userId: 1, fileId: 1 }, { unique: true });

module.exports = mongoose.model('DocumentInsight', DocumentInsightSchema);
