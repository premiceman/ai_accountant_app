const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const crypto = require('crypto');

const REQUIRED_ENV = ['R2_BUCKET', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];

function getEnvConfig() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing required R2 environment vars: ${missing.join(', ')}`);
  }
  return {
    bucket: process.env.R2_BUCKET,
    accountId: process.env.R2_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    publicHost: process.env.R2_PUBLIC_HOST || null,
  };
}

let s3Client;

function getClient() {
  if (s3Client) return s3Client;
  const { accountId, accessKeyId, secretAccessKey } = getEnvConfig();
  s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return s3Client;
}

function buildObjectKey({ userId, collectionSegment = 'auto', sessionPrefix, originalName, extension = '.pdf' }) {
  const safeName = String(originalName || 'document').replace(/[^a-zA-Z0-9._-]+/g, '-');
  const now = new Date();
  const parts = [
    userId,
    collectionSegment,
    now.getUTCFullYear().toString().padStart(4, '0'),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
  ];
  if (sessionPrefix) {
    parts.push(sessionPrefix);
  }
  const uuid = crypto.randomUUID();
  parts.push(`${uuid}__${safeName}${extension}`);
  return parts.join('/');
}

async function putObject({ key, body, contentType, metadata }) {
  const client = getClient();
  const { bucket } = getEnvConfig();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      Metadata: metadata,
    })
  );
}

async function getObject(key) {
  const client = getClient();
  const { bucket } = getEnvConfig();
  return client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
}

async function deleteObject(key) {
  const client = getClient();
  const { bucket } = getEnvConfig();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

async function listObjects(prefix, continuationToken) {
  const client = getClient();
  const { bucket } = getEnvConfig();
  return client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    })
  );
}

function keyToFileId(key) {
  return Buffer.from(key).toString('base64url');
}

function fileIdToKey(fileId) {
  return Buffer.from(fileId, 'base64url').toString('utf8');
}

module.exports = {
  getClient,
  getObject,
  putObject,
  deleteObject,
  listObjects,
  buildObjectKey,
  keyToFileId,
  fileIdToKey,
};
