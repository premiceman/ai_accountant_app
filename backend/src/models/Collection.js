// backend/src/models/Collection.js
const mongoose = require('mongoose');

const CollectionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
  name:   { type: String, required: true },
}, { timestamps: true });

module.exports = mongoose.model('Collection', CollectionSchema);
