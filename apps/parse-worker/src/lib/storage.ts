import { createHash, createHmac } from 'node:crypto';
import https from 'node:https';
import { Readable } from 'node:stream';

const REQUIRED_ENV = ['R2_BUCKET', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'] as const;

type RequiredEnvKey = (typeof REQUIRED_ENV)[number];

type EnvConfig = {
  bucket: string;
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
};

let cachedConfig: EnvConfig | null = null;

function assertEnv(): EnvConfig {
  if (cachedConfig) return cachedConfig;
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]) as RequiredEnvKey[];
  if (missing.length) {
    throw new Error(`Missing required R2 environment vars: ${missing.join(', ')}`);
  }
  cachedConfig = {
    bucket: process.env.R2_BUCKET as string,
    accountId: process.env.R2_ACCOUNT_ID as string,
    accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
  };
  return cachedConfig;
}

function toAmzDate(date: Date): { amzDate: string; dateStamp: string } {
  const pad = (value: number) => value.toString().padStart(2, '0');
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  const seconds = pad(date.getUTCSeconds());
  const amzDate = `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
  return { amzDate, dateStamp: `${year}${month}${day}` };
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

function getSigningKey(secretAccessKey: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

function normalisePath(pathname: string): string {
  return pathname
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
    .replace(/%2F/gi, '/');
}

type SignedRequest = {
  method: string;
  host: string;
  path: string;
  headers?: Record<string, string>;
};

function signRequest(config: EnvConfig, request: SignedRequest): Record<string, string> {
  const method = request.method.toUpperCase();
  const { amzDate, dateStamp } = toAmzDate(new Date());
  const region = 'auto';
  const service = 's3';
  const payloadHash = 'UNSIGNED-PAYLOAD';

  const initialHeaders: Record<string, string> = {
    host: request.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...(request.headers || {}),
  };

  const sortedHeaderKeys = Object.keys(initialHeaders)
    .map((key) => key.toLowerCase())
    .sort();

  const canonicalHeaders = sortedHeaderKeys
    .map((key) => `${key}:${initialHeaders[key].trim().replace(/\s+/g, ' ')}`)
    .join('\n');
  const signedHeaders = sortedHeaderKeys.join(';');

  const [rawPath, rawQuery = ''] = request.path.split('?');
  const canonicalQuery = rawQuery
    .split('&')
    .filter(Boolean)
    .map((part) => {
      const [name, value = ''] = part.split('=');
      return `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
    })
    .sort()
    .join('&');

  const canonicalPath = normalisePath(rawPath);

  const canonicalRequest = [
    method,
    canonicalPath,
    canonicalQuery,
    canonicalHeaders ? `${canonicalHeaders}\n` : '\n',
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = getSigningKey(config.secretAccessKey, dateStamp, region, service);
  const signature = hmac(signingKey, stringToSign).toString('hex');

  const authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    ...initialHeaders,
    Authorization: authorization,
  };
}

function encodeKey(key: string): string {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export function fileIdToKey(fileId: string): string {
  return Buffer.from(fileId, 'base64url').toString('utf8');
}

export async function getObjectStream(key: string): Promise<Readable> {
  const env = assertEnv();
  const host = `${env.accountId}.r2.cloudflarestorage.com`;
  const path = `/${env.bucket}/${encodeKey(key.replace(/^\/+/, ''))}`;

  const headers = signRequest(env, {
    method: 'GET',
    host,
    path,
  });

  return new Promise<Readable>((resolve, reject) => {
    const request = https.request(
      {
        host,
        path,
        method: 'GET',
        headers,
      },
      (response) => {
        if ((response.statusCode ?? 500) >= 200 && (response.statusCode ?? 500) < 300) {
          resolve(response);
          return;
        }

        const status = response.statusCode ?? 0;
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on('end', () => {
          const message = Buffer.concat(chunks).toString('utf8');
          reject(new Error(`R2 getObject failed with status ${status}: ${message || 'No response body'}`));
        });
      }
    );

    request.on('error', (error) => {
      reject(error);
    });

    request.end();
  });
}
