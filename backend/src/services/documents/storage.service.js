// backend/src/services/documents/storage.service.js
// GridFS helpers for storing and retrieving document files.
// Keeps backward-compatible function names but now supports optional userId.

const mongoose = require('mongoose');
const { GridFSBucket, ObjectId } = require('mongodb');

function bucket() {
  if (!mongoose.connection || !mongoose.connection.db) {
    throw new Error('MongoDB not connected');
  }
  return new GridFSBucket(mongoose.connection.db, { bucketName: 'documents' });
}

/**
 * Save a Buffer to GridFS.
 * @param {Buffer} buffer
 * @param {string} filename
 * @param {object} metadata  - e.g. { userId, type, year, mime }
 * @returns {Promise<ObjectId>} the GridFS file id
 */
async function saveBufferToGridFS(buffer, filename, metadata = {}) {
  return new Promise((resolve, reject) => {
    const uploadStream = bucket().openUploadStream(filename || 'file', {
      metadata,
      contentType: metadata?.mime
    });
    uploadStream.on('finish', () => resolve(uploadStream.id));
    uploadStream.on('error', reject);
    uploadStream.end(buffer);
  });
}

/**
 * Stream a file by id to a writable stream (e.g. res).
 */
function streamFileById(id) {
  const _id = new ObjectId(String(id));
  return bucket().openDownloadStream(_id);
}

/**
 * List files. If userId provided, filter by userId metadata.
 */
async function listFiles(userId) {
  const q = userId ? { 'metadata.userId': String(userId) } : {};
  const files = await bucket().find(q).toArray();
  return files.sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));
}

/**
 * Delete by id. If userId provided, enforce ownership; otherwise delete by id.
 */
async function deleteFileById(id, userId) {
  const _id = new ObjectId(String(id));
  const q = userId ? { _id, 'metadata.userId': String(userId) } : { _id };
  const files = await bucket().find(q).toArray();
  if (files.length === 0) {
    const err = new Error('Not found');
    err.code = 404;
    throw err;
  }
  await bucket().delete(_id);
  return true;
}

module.exports = {
  saveBufferToGridFS,
  streamFileById,
  listFiles,
  deleteFileById,
};
