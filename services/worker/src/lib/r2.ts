import { S3Client, GetObjectCommand, type GetObjectCommandOutput } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';

type EnvConfig = {
  bucket: string;
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
};

const REQUIRED_ENV = ['R2_BUCKET', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'] as const;

type RequiredEnvKey = (typeof REQUIRED_ENV)[number];

function getEnvConfig(): EnvConfig {
  const missing: RequiredEnvKey[] = REQUIRED_ENV.filter((key) => !process.env[key]) as RequiredEnvKey[];
  if (missing.length) {
    throw new Error(`Missing required R2 environment vars: ${missing.join(', ')}`);
  }

  return {
    bucket: process.env.R2_BUCKET as string,
    accountId: process.env.R2_ACCOUNT_ID as string,
    accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
  };
}

let client: S3Client | null = null;

function getClient(): S3Client {
  if (!client) {
    const { accountId, accessKeyId, secretAccessKey } = getEnvConfig();
    client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  return client;
}

export async function getObject(key: string): Promise<GetObjectCommandOutput & { Body: Readable }> {
  const { bucket } = getEnvConfig();
  const result = await getClient().send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );

  if (!result.Body || !(result.Body instanceof Readable)) {
    throw new Error('Expected R2 object body to be a Node.js readable stream');
  }

  return { ...result, Body: result.Body };
}

export function fileIdToKey(fileId: string): string {
  return Buffer.from(fileId, 'base64url').toString('utf8');
}
