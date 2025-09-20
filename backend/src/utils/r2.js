// backend/src/utils/r2.js
const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const endpoint = process.env.R2_S3_ENDPOINT; // e.g. https://<ACCOUNT_ID>.r2.cloudflarestorage.com

const s3 = new S3Client({
  region: "auto",
  endpoint,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
});

async function presignPut({ Key, ContentType, expiresIn = 900 }) {
  const cmd = new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key, ContentType });
  return getSignedUrl(s3, cmd, { expiresIn });
}

async function presignGet({ Key, expiresIn = 900 }) {
  const cmd = new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key });
  return getSignedUrl(s3, cmd, { expiresIn });
}

async function headObject(Key) {
  return s3.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key }));
}

async function getObjectBuffer(Key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key }));
  const arr = await res.Body?.transformToByteArray();
  return Buffer.from(arr || []);
}

module.exports = { s3, presignPut, presignGet, headObject, getObjectBuffer };
