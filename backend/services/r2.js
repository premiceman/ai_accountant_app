'use strict';

const path = require('path');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const config = require('../config');

const { r2 } = config;

const s3 = new S3Client({
  region: 'auto',
  endpoint: r2.endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: r2.accessKeyId,
    secretAccessKey: r2.secretAccessKey,
  },
});

function sanitizeSegment(segment) {
  return String(segment || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-');
}

function sanitizeFilename(filename) {
  const base = path.basename(String(filename || 'document.pdf'));
  const cleaned = base.replace(/[^a-zA-Z0-9._()\-\s]+/g, '_').replace(/\s+/g, ' ').trim();
  const safe = cleaned || 'document.pdf';
  if (safe.length <= 140) return safe;
  const ext = path.extname(safe).slice(0, 16);
  const stem = path.basename(safe, ext).slice(0, Math.max(1, 140 - ext.length));
  return `${stem}${ext}`;
}

function buildVaultKey({ userId, documentId, filename }) {
  const userSegment = sanitizeSegment(userId || 'unknown');
  const docSegment = sanitizeSegment(documentId || 'doc');
  const safeFilename = sanitizeFilename(filename);
  return `users/${userSegment}/vault/${docSegment}/${safeFilename}`;
}

async function createPresignedUpload({ key, contentType, expiresIn = 5 * 60 }) {
  const command = new PutObjectCommand({
    Bucket: r2.bucket,
    Key: key,
    ContentType: contentType || 'application/octet-stream',
  });
  return getSignedUrl(s3, command, { expiresIn });
}

async function createPresignedDownload({ key, expiresIn = 5 * 60 }) {
  const command = new GetObjectCommand({
    Bucket: r2.bucket,
    Key: key,
  });
  return getSignedUrl(s3, command, { expiresIn });
}

async function deleteObject(key) {
  if (!key) return;
  const command = new DeleteObjectCommand({
    Bucket: r2.bucket,
    Key: key,
  });
  try {
    await s3.send(command);
  } catch (err) {
    if (err?.name === 'NoSuchKey') return;
    throw err;
  }
}

module.exports = {
  s3,
  buildVaultKey,
  createPresignedUpload,
  createPresignedDownload,
  deleteObject,
  sanitizeFilename,
};
