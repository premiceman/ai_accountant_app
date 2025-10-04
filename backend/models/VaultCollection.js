// backend/models/VaultCollection.js
const mongoose = require('mongoose');

const VaultCollectionSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name:       { type: String, required: true, trim: true },
  description:{ type: String, default: '' },
}, { timestamps: true });

// Unique per-user collection name
VaultCollectionSchema.index({ userId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('VaultCollection', VaultCollectionSchema);
