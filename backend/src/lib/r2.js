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

function buildObjectKey({
  userId,
  userPrefix = '',
  collectionSegment = 'auto',
  sessionPrefix,
  originalName,
  extension = '.pdf',
}) {
  const sanitize = (value) => String(value || '').replace(/[^a-zA-Z0-9._-]+/g, '-');
  const safeName = sanitize(originalName || 'document');
  const prefix = String(userPrefix || '').replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '') || null;
  let baseSegment;
  if (prefix) {
    baseSegment = prefix.endsWith(`-${userId}`) ? prefix : `${prefix}-${userId}`;
  } else {
    baseSegment = userId;
  }

  const decorate = (value) => {
    const cleaned = sanitize(value);
    if (!cleaned) return cleaned;
    return prefix ? `${prefix}-${cleaned}` : cleaned;
  };

  const now = new Date();
  const parts = [
    baseSegment,
    decorate(collectionSegment),
    now.getUTCFullYear().toString().padStart(4, '0'),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
  ];

  if (sessionPrefix) {
    parts.push(decorate(sessionPrefix));
  }

  const uuid = crypto.randomUUID();
  const prefixStub = prefix ? `${prefix}-` : '';
  const fileSegment = `${prefixStub}${sanitize(uuid)}__${safeName}${extension}`;
  parts.push(fileSegment);

  return parts.filter(Boolean).join('/');
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
