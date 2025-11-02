const { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { Readable } = require('node:stream');
const { config } = require('../config');

const client = new S3Client({
  region: 'auto',
  endpoint: config.r2.endpoint,
  credentials: {
    accessKeyId: config.r2.accessKeyId,
    secretAccessKey: config.r2.secretAccessKey,
  },
});

function objectKeyForUpload({ userId, batchId, fileId, filename }) {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return `users/${userId}/${batchId}/${fileId}/${safeName}`;
}

async function createPresignedPut({ key, contentType, contentLength }) {
  const command = new PutObjectCommand({
    Bucket: config.r2.bucket,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  });
  const url = await getSignedUrl(client, command, { expiresIn: 60 * 10 });
  return { url, method: 'PUT', headers: { 'Content-Type': contentType } };
}

async function createPresignedGet({ key, expiresIn = 60 * 30 }) {
  const command = new GetObjectCommand({ Bucket: config.r2.bucket, Key: key });
  const url = await getSignedUrl(client, command, { expiresIn });
  return url;
}

async function readObjectBuffer(key) {
  const command = new GetObjectCommand({ Bucket: config.r2.bucket, Key: key });
  const response = await client.send(command);
  const chunks = [];
  for await (const chunk of response.Body instanceof Readable ? response.Body : Readable.from(response.Body)) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function writeJson(key, data) {
  const command = new PutObjectCommand({
    Bucket: config.r2.bucket,
    Key: key,
    Body: Buffer.from(JSON.stringify(data)),
    ContentType: 'application/json',
  });
  await client.send(command);
}

async function writeBuffer(key, buffer, contentType) {
  const command = new PutObjectCommand({
    Bucket: config.r2.bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });
  await client.send(command);
}

async function deleteObject(key) {
  const command = new DeleteObjectCommand({ Bucket: config.r2.bucket, Key: key });
  await client.send(command);
}

async function statObject(key) {
  try {
    const command = new HeadObjectCommand({ Bucket: config.r2.bucket, Key: key });
    return await client.send(command);
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw error;
  }
}

module.exports = {
  client,
  objectKeyForUpload,
  createPresignedPut,
  createPresignedGet,
  readObjectBuffer,
  writeJson,
  writeBuffer,
  deleteObject,
  statObject,
};
