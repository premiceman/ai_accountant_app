// backend/models/VaultFile.js
const mongoose = require('mongoose');

const VaultFileSchema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  collectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'VaultCollection', required: true, index: true },

  originalName: { type: String, required: true },
  storedName:   { type: String, required: true },     // on disk
  size:         { type: Number, required: true },     // bytes
  mime:         { type: String, required: true, default: 'application/pdf' },
  ext:          { type: String, default: 'pdf' },

  // Relative path under /uploads, e.g. vault/<userId>/<collectionId>/<storedName>
  pathRel:      { type: String, required: true },

  uploadedAt:   { type: Date, default: () => new Date() },
}, { timestamps: true });

module.exports = mongoose.model('VaultFile', VaultFileSchema);
