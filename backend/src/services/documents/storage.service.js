// backend/src/services/documents/storage.service.js
// GridFS helpers for storing and retrieving document files, with per-user enforcement.

const mongoose = require('mongoose');
const { GridFSBucket, ObjectId } = require('mongodb');

function bucket() {
  if (!mongoose.connection || !mongoose.connection.db) {
    throw new Error('MongoDB not connected');
  }
  return new GridFSBucket(mongoose.connection.db, { bucketName: 'documents' });
}

function filesColl() {
  if (!mongoose.connection || !mongoose.connection.db) {
    throw new Error('MongoDB not connected');
  }
  return mongoose.connection.db.collection('documents.files');
}

/**
 * Save a Buffer to GridFS (native driver).
 * NOTE: The "finish" event does NOT pass a file doc. Use uploadStream.id and (optionally)
 *       fetch the created file document from the files collection.
 * @param {Buffer} buffer
 * @param {String} filename
 * @param {Object} opts - { contentType?, metadata? }
 * @returns {Promise<{ id, length, uploadDate, contentType, filename, metadata }>}
 */
async function saveBufferToGridFS(buffer, filename, opts = {}) {
  const { contentType = 'application/octet-stream', metadata = {} } = opts;

  return new Promise((resolve, reject) => {
    const uploadStream = bucket().openUploadStream(filename, {
      contentType,
      metadata,
    });

    uploadStream.once('error', reject);
    uploadStream.once('finish', async () => {
      try {
        const _id = uploadStream.id; // ObjectId of the stored file
        // Fetch the file doc to get canonical length/uploadDate/etc.
        const doc = await filesColl().findOne({ _id });
        resolve({
          id: String(_id),
          length: doc?.length ?? buffer.length,
          uploadDate: doc?.uploadDate ?? new Date(),
          contentType: doc?.contentType ?? contentType,
          filename: doc?.filename ?? filename,
          metadata: doc?.metadata ?? metadata,
        });
      } catch (e) {
        // Fallback: still return something usable even if the lookup failed
        resolve({
          id: String(uploadStream.id),
          length: buffer.length,
          uploadDate: new Date(),
          contentType,
          filename,
          metadata,
        });
      }
    });

    uploadStream.end(buffer);
  });
}

/**
 * List files for a user (and optional filters).
 * @param {Object} filter - { userId, type?, year? }
 * @returns {Promise<Array>}
 */
async function listFiles(filter = {}) {
  const { userId, type, year } = filter;
  const query = {};
  if (userId) query['metadata.userId'] = String(userId);
  if (type)   query['metadata.type'] = type;
  if (year)   query['metadata.year'] = String(year);

  const cur = filesColl().find(query).sort({ uploadDate: -1 });

  const out = [];
  await cur.forEach((f) => {
    out.push({
      id: String(f._id),
      filename: f.filename,
      length: f.length,
      uploadDate: f.uploadDate,
      mime: f.contentType || 'application/octet-stream',
      type: f.metadata?.type || null,
      year: f.metadata?.year || null,
      userId: f.metadata?.userId || null,
      storedAs: String(f._id),
    });
  });
  return out;
}

/** Ensure a file belongs to the given user; returns file doc if so. */
async function assertUserOwnsFile(fileId, userId) {
  const _id = typeof fileId === 'string' ? new ObjectId(fileId) : fileId;
  const doc = await filesColl().findOne({ _id, 'metadata.userId': String(userId) });
  if (!doc) {
    const err = new Error('Not found');
    err.code = 404;
    throw err;
  }
  return doc;
}

/** Stream a file if and only if it belongs to the user (ownership check must be done before calling). */
function streamFileById(fileId) {
  const _id = typeof fileId === 'string' ? new ObjectId(fileId) : fileId;
  return bucket().openDownloadStream(_id);
}

/** Delete a file if and only if it belongs to the user. */
async function deleteFileById(fileId, userId) {
  const _id = typeof fileId === 'string' ? new ObjectId(fileId) : fileId;
  await assertUserOwnsFile(_id, userId);
  await bucket().delete(_id);
  return true;
}

module.exports = {
  saveBufferToGridFS,
  listFiles,
  streamFileById,
  deleteFileById,
  assertUserOwnsFile,
};
