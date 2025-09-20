// backend/src/models/File.js
const mongoose = require('mongoose');

const FileSchema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
  collectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Collection', index: true, required: true },
  name:         { type: String, required: true },
  size:         { type: Number, default: 0 },
  r2Key:        { type: String, required: true },
  contentType:  { type: String },
}, { timestamps: true });

module.exports = mongoose.model('File', FileSchema);
