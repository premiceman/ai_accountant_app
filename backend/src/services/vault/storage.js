const path = require('path');
const { randomUUID } = require('crypto');
const { putObject, buildObjectKey, keyToFileId } = require('../../lib/r2');
const { sha256 } = require('../../lib/hash');
const { isPdf } = require('../../lib/pdf');
const { enumerateZipBuffers } = require('../../lib/zip');

const MAX_FILE_BYTES = 50 * 1024 * 1024;

function ensureWithinSize(buffer) {
  if (!buffer || buffer.length === 0) {
    throw new Error('Empty file');
  }
  if (buffer.length > MAX_FILE_BYTES) {
    throw new Error('File exceeds 50MB limit');
  }
}

async function persistPdf({ userId, userPrefix, collectionId = 'auto', sessionPrefix, originalName, buffer }) {
  ensureWithinSize(buffer);
  if (!isPdf(buffer)) {
    throw new Error('Only PDF files are supported');
  }
  const key = buildObjectKey({
    userId,
    userPrefix,
    collectionSegment: collectionId || 'auto',
    sessionPrefix,
    originalName,
    extension: '.pdf',
  });
  await putObject({ key, body: buffer, contentType: 'application/pdf' });
  return {
    key,
    fileId: keyToFileId(key),
    contentHash: sha256(buffer),
    size: buffer.length,
  };
}

async function handleUpload({ userId, userPrefix, file, collectionId = 'auto' }) {
  if (!file) throw new Error('File missing');
  const ext = path.extname(file.originalname || '').toLowerCase();
  const isZip = ext === '.zip';

  if (isZip) {
    ensureWithinSize(file.buffer);
    const sessionId = randomUUID();
    const sessionPrefix = `${sessionId}`;
    const zipKey = buildObjectKey({
      userId,
      userPrefix,
      collectionSegment: sessionPrefix,
      originalName: 'upload.zip',
      extension: '.zip',
    });
    await putObject({ key: zipKey, body: file.buffer, contentType: 'application/zip' });
    const entries = await enumerateZipBuffers(file.buffer, (entry) => entry.fileName.toLowerCase().endsWith('.pdf'));
    const storedFiles = [];
    for (const entry of entries) {
      const pdfName = path.basename(entry.fileName) || 'document.pdf';
      try {
        const stored = await persistPdf({
          userId,
          userPrefix,
          collectionId,
          sessionPrefix,
          originalName: pdfName,
          buffer: entry.buffer,
        });
        storedFiles.push({ ...stored, originalName: pdfName, sessionId, collectionId });
      } catch (err) {
        storedFiles.push({ error: err.message, originalName: pdfName, sessionId });
      }
    }
    return { sessionId, files: storedFiles };
  }

  const sessionId = randomUUID();
  const stored = await persistPdf({
    userId,
    userPrefix,
    collectionId,
    sessionPrefix: sessionId,
    originalName: file.originalname,
    buffer: file.buffer,
  });
  return { sessionId, files: [{ ...stored, originalName: file.originalname, sessionId, collectionId }] };
}

module.exports = { handleUpload };
