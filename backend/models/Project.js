// backend/models/Project.js
const mongoose = require('mongoose');

const ProjectSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name:    { type: String, required: true },
  description: { type: String, default: '' },
  openAiVectorStoreId: { type: String, default: null },
  openAiNamespace: { type: String, default: null }
}, { timestamps: true });

module.exports = mongoose.model('Project', ProjectSchema);
