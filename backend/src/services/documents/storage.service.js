// backend/src/services/documents/storage.service.js
const { PassThrough } = require('stream');
const mongoose = require('mongoose');

function bucket() {
  const db = mongoose.connection.db;
  if (!db) throw new Error('No MongoDB connection');
  return new mongoose.mongo.GridFSBucket(db, { bucketName: 'documents' });
}

async function saveBufferToGridFS(buffer, filename, metadata) {
  const b = bucket();
  const stream = new PassThrough();
  stream.end(buffer);
  return new Promise((resolve, reject) => {
    const upload = b.openUploadStream(filename, { metadata });
    stream.pipe(upload)
      .on('error', reject)
      .on('finish', () => resolve(upload.id));
  });
}

async function listFiles(userId) {
  const b = bucket();
  const cur = b.find({ 'metadata.userId': String(userId) });
  return await cur.toArray();
}

module.exports = { saveBufferToGridFS, listFiles };
