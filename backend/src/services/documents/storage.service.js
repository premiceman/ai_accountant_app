// backend/src/services/documents/storage.service.js
const mongoose = require('mongoose');
const { GridFSBucket, ObjectId } = require('mongodb');

function bucket() {
  if (!mongoose.connection?.db) throw new Error('MongoDB not connected');
  return new GridFSBucket(mongoose.connection.db, { bucketName: 'documents' });
}

async function saveBufferToGridFS(buffer, filename, metadata = {}) {
  return new Promise((resolve, reject) => {
    const uploadStream = bucket().openUploadStream(filename || 'file', { metadata });
    uploadStream.on('finish', () => resolve(uploadStream.id));
    uploadStream.on('error', reject);
    uploadStream.end(buffer);
  });
}

async function listFiles(userId) {
  const files = await bucket().find({ 'metadata.userId': String(userId) }).toArray();
  return files.sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));
}

async function deleteFileById(id, userId) {
  const _id = new ObjectId(String(id));
  const files = await bucket().find({ _id, 'metadata.userId': String(userId) }).toArray();
  if (files.length === 0) {
    const err = new Error('Not found'); err.code = 404; throw err;
  }
  await bucket().delete(_id);
  return true;
}

module.exports = { saveBufferToGridFS, listFiles, deleteFileById };
