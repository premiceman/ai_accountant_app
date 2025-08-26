// backend/src/models/Document.js
const mongoose = require('mongoose');

const DocumentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
  gfsId: { type: mongoose.Schema.Types.ObjectId, required: true },
  filename: { type: String, required: true },
  type: { type: String, default: 'other' }, // e.g., 'p60','p45','bank_statement'
  year: { type: Number },
  tags: [{ type: String }],
  uploadedAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Document', DocumentSchema);
