// backend/src/utils/r2.js
const {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    ListObjectsV2Command,
    HeadObjectCommand
  } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  
  const cfg = {
    region: 'auto',
    endpoint: process.env.R2_S3_ENDPOINT, // e.g. https://<account>.r2.cloudflarestorage.com
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
    }
  };
  const BUCKET = process.env.R2_BUCKET;
  
  if (!cfg.endpoint || !cfg.credentials.accessKeyId || !cfg.credentials.secretAccessKey || !BUCKET) {
    console.warn('[r2] Missing R2 env; check R2_S3_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET');
  }
  
  const s3 = new S3Client(cfg);
  
  async function putObject(key, body, contentType) {
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }));
  }
  async function headObject(key) {
    return s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
  }
  async function deleteObject(key) {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  }
  async function signedGetUrl(key, expiresIn = 300) {
    const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    return getSignedUrl(s3, cmd, { expiresIn });
  }
  async function listAll(prefix) {
    // returns array of { Key, Size, LastModified }
    const out = [];
    let ContinuationToken = undefined;
    do {
      const res = await s3.send(new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken
      }));
      (res.Contents || []).forEach(o => out.push(o));
      ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (ContinuationToken);
    return out;
  }
  
  module.exports = { s3, BUCKET, putObject, signedGetUrl, deleteObject, headObject, listAll };
  