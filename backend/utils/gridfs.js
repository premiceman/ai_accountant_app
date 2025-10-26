// backend/utils/gridfs.js
const mongoose = require('mongoose');

let bucket = null;

function resetBucket() {
  bucket = null;
}

function ensureBucket() {
  const connection = mongoose.connection;
  if (!connection || connection.readyState !== 1) {
    const error = new Error('Database not ready');
    error.status = 503;
    throw error;
  }
  if (!bucket) {
    bucket = new mongoose.mongo.GridFSBucket(connection.db, { bucketName: 'files' });
    connection.once('close', () => resetBucket());
    connection.once('disconnected', () => resetBucket());
  }
  return bucket;
}

async function deleteFile(gridFsId) {
  if (!gridFsId) return;
  const bucketInstance = ensureBucket();
  try {
    await bucketInstance.delete(gridFsId);
  } catch (err) {
    if (err && err.code === 'ENOENT') return;
    throw err;
  }
}

module.exports = {
  ensureBucket,
  deleteFile,
};
