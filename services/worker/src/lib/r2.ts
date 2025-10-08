import { Readable } from 'node:stream';

type DynamicImport = <T>(specifier: string) => Promise<T>;

// Use an indirect dynamic import so TypeScript can compile even when the package is not installed locally (as in CI builds
// that omit optional dependencies). The real module is still required at runtime.
const dynamicImport = Function('specifier', 'return import(specifier);') as DynamicImport;

type GetObjectCommandOutput = {
  Body?: unknown;
  [key: string]: unknown;
};

type AwsSdkModule = {
  S3Client: new (config: {
    region: string;
    endpoint: string;
    credentials: { accessKeyId: string; secretAccessKey: string };
  }) => {
    send: (command: unknown) => Promise<GetObjectCommandOutput>;
  };
  GetObjectCommand: new (config: { Bucket: string; Key: string }) => unknown;
};

type S3ClientInstance = AwsSdkModule['S3Client'] extends new (...args: any[]) => infer T ? T : never;

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

let sdkModulePromise: Promise<AwsSdkModule> | null = null;

async function loadAwsSdk(): Promise<AwsSdkModule> {
  if (!sdkModulePromise) {
    sdkModulePromise = (async () => {
      try {
        return await dynamicImport<AwsSdkModule>('@aws-sdk/client-s3');
      } catch (error) {
        sdkModulePromise = null;
        const nodeError = error as NodeJS.ErrnoException;
        const message =
          nodeError?.code === 'ERR_MODULE_NOT_FOUND' || nodeError?.code === 'MODULE_NOT_FOUND'
            ? 'Missing @aws-sdk/client-s3 runtime dependency. Install it with "npm install @aws-sdk/client-s3" in services/worker.'
            : nodeError?.message ?? 'Unknown error loading @aws-sdk/client-s3';
        throw new Error(`Unable to load @aws-sdk/client-s3: ${message}`);
      }
    })();
  }

  return sdkModulePromise;
}

let clientPromise: Promise<S3ClientInstance> | null = null;

async function getClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const { S3Client } = await loadAwsSdk();
      const { accountId, accessKeyId, secretAccessKey } = getEnvConfig();
      return new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });
    })();
  }

  return clientPromise;
}

export async function getObject(key: string): Promise<GetObjectCommandOutput & { Body: Readable }> {
  const { bucket } = getEnvConfig();
  const { GetObjectCommand } = await loadAwsSdk();
  const client = await getClient();
  const result = await client.send(
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
