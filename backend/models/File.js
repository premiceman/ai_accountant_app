// backend/models/File.js
const mongoose = require('mongoose');

const FileSchema = new mongoose.Schema({
  projectId:   { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  ownerId:     { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  filename:    { type: String, required: true },
  length:      { type: Number, required: true },
  chunkSize:   { type: Number, required: true },
  uploadDate:  { type: Date, required: true },
  md5:         { type: String, default: null },
  mime:        { type: String, required: true },
  status:      { type: String, enum: ['clean','quarantined','pending'], default: 'pending', index: true },
  gridFsId:    { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
  openAiFileId: { type: String, default: null },
  openAiIndexedAt: { type: Date, default: null },
  openAiIndexError: { type: String, default: null }
}, { timestamps: true });

module.exports = mongoose.model('File', FileSchema);
