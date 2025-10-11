const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('module');

process.env.JSON_TEST = 'true';

const authPath = path.resolve(__dirname, '../middleware/auth.js');
const userPath = path.resolve(__dirname, '../models/User.js');
const ingestPath = path.resolve(__dirname, '../src/services/documents/ingest.js');
const expressStubPath = path.resolve(__dirname, '__expressStub.js');
const multerStubPath = path.resolve(__dirname, '__multerStub.js');
const dayjsStubPath = path.resolve(__dirname, '__dayjsStub.js');
const awsClientStubPath = path.resolve(__dirname, '__awsClientStub.js');

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(request, parent, isMain, options) {
  if (request === 'express') return expressStubPath;
  if (request === 'multer') return multerStubPath;
  if (request === 'dayjs') return dayjsStubPath;
  if (request === '@aws-sdk/client-s3') return awsClientStubPath;
  return originalResolve.call(this, request, parent, isMain, options);
};

require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: (_req, _res, next) => next(),
};

require.cache[userPath] = {
  id: userPath,
  filename: userPath,
  loaded: true,
  exports: {
    findById() {
      return {
        lean: async () => ({ firstName: 'Test', lastName: 'User', username: 'test.user' }),
      };
    },
  },
};

const { DocumentProcessingError } = require('../src/services/documents/pipeline/errors');

require.cache[ingestPath] = {
  id: ingestPath,
  filename: ingestPath,
  loaded: true,
  exports: {
    async autoAnalyseDocument() {
      throw new DocumentProcessingError('Structured extraction failed', { code: 'STRUCTURED_EXTRACTION_FAILED' });
    },
  },
};

const router = require('../src/routes/jsonTest.routes.js');

const uploadRoute = router.stack.find((layer) => layer.route?.path === '/upload');
if (!uploadRoute) {
  throw new Error('Upload route not registered');
}
const handler = uploadRoute.route.stack[uploadRoute.route.stack.length - 1].handle;

async function run() {
  let statusCode = null;
  let payload = null;
  const req = {
    user: { id: 'user-1' },
    file: {
      mimetype: 'application/pdf',
      originalname: 'statement.pdf',
      buffer: Buffer.from('%PDF-1.4'),
      size: 8,
    },
  };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      payload = body;
      return this;
    },
  };

  await handler(req, res, (err) => {
    if (err) throw err;
  });

  assert.equal(statusCode, 200);
  assert.deepEqual(payload, {
    ok: false,
    error: 'Structured extraction failed',
    code: 'STRUCTURED_EXTRACTION_FAILED',
  });
  Module._resolveFilename = originalResolve;
  delete require.cache[expressStubPath];
  delete require.cache[multerStubPath];
  delete require.cache[dayjsStubPath];
  delete require.cache[awsClientStubPath];
  console.log('JSON test upload error handling passed');
}

run().catch((err) => {
  Module._resolveFilename = originalResolve;
  delete require.cache[expressStubPath];
  delete require.cache[multerStubPath];
  delete require.cache[dayjsStubPath];
  delete require.cache[awsClientStubPath];
  console.error(err);
  process.exitCode = 1;
});
