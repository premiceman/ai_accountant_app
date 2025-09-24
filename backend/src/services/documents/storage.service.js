// backend/src/services/documents/storage.service.js
//
// Thin R2-backed storage service for the Documents section.
// Provides the same surface your code expects from the old GridFS wrapper.
//
// Methods:
//   list(userId)
//   uploadMany(userId, files[])  // files: [{ buffer, originalname, mimetype, size }]
//   remove(userId, id)
//   getViewStream(userId, id)    // returns { stream, headers }
//   getDownloadStream(userId, id)// returns { stream, headers }
//
const dayjs = require('dayjs');
const { randomUUID } = require('crypto');
const { s3, BUCKET, putObject, deleteObject, listAll } = require('../../utils/r2');
const { GetObjectCommand } = require('@aws-sdk/client-s3');

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64').toString('utf8');
}
function keyToFileId(key) { return b64url(key); }
function fileIdToKey(id) { return b64urlDecode(id); }

function docsPrefix(userId) { return `${userId}/accounting files/`; }
function extractDisplayNameFromKey(key) {
  const tail = String(key).split('/').pop() || 'document.pdf';
  const m = tail.match(/^(\d{8})-([0-9a-fA-F-]{36})-(.+)$/i);
  return m ? m[3] : tail;
}

async function list(userId) {
  const objs = (await listAll(docsPrefix(userId))).filter(o => !String(o.Key).endsWith('/'));
  return objs.map(o => {
    const key = String(o.Key);
    const id = keyToFileId(key);
    return {
      id,
      filename: extractDisplayNameFromKey(key),
      length: o.Size || 0,
      uploadDate: o.LastModified ? new Date(o.LastModified) : null,
      contentType: 'application/octet-stream'
    };
  }).sort((a,b) => (b.uploadDate || 0) - (a.uploadDate || 0));
}

async function uploadMany(userId, files) {
  const out = [];
  for (const f of files || []) {
    const date = dayjs().format('YYYYMMDD');
    const safeBase = String(f.originalname || 'document.pdf').replace(/[^\w.\- ]+/g, '_');
    const key = `${userId}/accounting files/${date}-${randomUUID()}-${safeBase}`;
    await putObject(key, f.buffer, f.mimetype || 'application/octet-stream');
    out.push({
      id: keyToFileId(key),
      filename: safeBase,
      length: f.size || 0,
      uploadDate: new Date(),
      contentType: f.mimetype || 'application/octet-stream'
    });
  }
  return out;
}

async function remove(userId, id) {
  const key = fileIdToKey(String(id || ''));
  if (!key.startsWith(docsPrefix(userId))) throw new Error('Forbidden');
  await deleteObject(key).catch(() => {});
  return { ok: true };
}

async function getViewStream(userId, id) {
  const key = fileIdToKey(String(id || ''));
  if (!key.startsWith(docsPrefix(userId))) throw new Error('Forbidden');
  const data = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return {
    stream: data.Body,
    headers: {
      'Content-Type': data.ContentType || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${encodeURIComponent(key.split('/').pop() || 'document.pdf')}"`
    }
  };
}

async function getDownloadStream(userId, id) {
  const key = fileIdToKey(String(id || ''));
  if (!key.startsWith(docsPrefix(userId))) throw new Error('Forbidden');
  const data = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return {
    stream: data.Body,
    headers: {
      'Content-Type': data.ContentType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(key.split('/').pop() || 'document.pdf')}"`
    }
  };
}

module.exports = {
  list,
  uploadMany,
  remove,
  getViewStream,
  getDownloadStream,
};
