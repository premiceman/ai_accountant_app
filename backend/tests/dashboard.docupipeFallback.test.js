const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('module');

const baseResolve = Module._resolveFilename;

const requiredEnv = {
  MONGODB_URI: 'mongodb://localhost/test',
  R2_ACCOUNT_ID: 'test-account',
  R2_ACCESS_KEY_ID: 'test-key',
  R2_SECRET_ACCESS_KEY: 'test-secret',
  R2_BUCKET: 'test-bucket',
  R2_S3_ENDPOINT: 'https://example.com',
  DOCUPIPE_API_KEY: 'test-docupipe-key',
  PAYSLIP_SCHEMA_ID: 'schema-payslip',
  BANK_STATEMENT_SCHEMA_ID: 'schema-statement',
  OPENAI_API_KEY: 'test-openai-key',
  DOCUPIPE_WORKFLOW_ID: 'wf-test',
  DOCUPIPE_BASE_URL: 'https://docupipe.example.com',
};

const originalEnv = {};

async function run() {
  Object.entries(requiredEnv).forEach(([key, value]) => {
    originalEnv[key] = process.env[key];
    process.env[key] = value;
  });

  const expressStubPath = path.resolve(__dirname, '__expressStub.js');
  const multerStubPath = path.resolve(__dirname, '__multerStub.js');
  const dashboardRoutePath = path.resolve(__dirname, '..', 'src', 'v2', 'routes', 'dashboard.js');
  const docupipeServicePath = path.resolve(__dirname, '..', 'src', 'v2', 'services', 'docupipe.js');
  const r2ServicePath = path.resolve(__dirname, '..', 'src', 'v2', 'services', 'r2.js');
  const uploadedDocumentPath = path.resolve(__dirname, '..', 'src', 'v2', 'models', 'UploadedDocument.js');
  const documentResultPath = path.resolve(__dirname, '..', 'src', 'v2', 'models', 'DocumentResult.js');
  const modelsIndexPath = path.resolve(__dirname, '..', 'src', 'v2', 'models', 'index.js');

  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function resolve(request, parent, isMain, options) {
    if (request === 'express') return expressStubPath;
    if (request === 'multer') return multerStubPath;
    if (request === 'dayjs') return path.resolve(__dirname, '__dayjsStub.js');
    return originalResolve.call(this, request, parent, isMain, options);
  };

  const pollJobCalls = [];
  let deleteCalls = 0;
  let documentResultPayload = null;

  class FakeObjectId {
    constructor(value) {
      this.value = value;
    }

    toString() {
      return this.value;
    }

    static isValid() {
      return true;
    }
  }

  require.cache[modelsIndexPath] = {
    id: modelsIndexPath,
    filename: modelsIndexPath,
    loaded: true,
    exports: {
      mongoose: {
        Types: {
          ObjectId: FakeObjectId,
        },
      },
    },
  };

  require.cache[uploadedDocumentPath] = {
    id: uploadedDocumentPath,
    filename: uploadedDocumentPath,
    loaded: true,
    exports: {
      findOne() {
        return { lean: async () => null };
      },
      findOneAndUpdate(_query, update) {
        return {
          lean: async () => ({ _id: 'uploaded-doc-1', ...update }),
        };
      },
    },
  };

  require.cache[documentResultPath] = {
    id: documentResultPath,
    filename: documentResultPath,
    loaded: true,
    exports: {
      findOne() {
        return { lean: async () => null };
      },
      async create(payload) {
        documentResultPayload = payload;
        return { _id: 'doc-result-1', ...payload };
      },
    },
  };

  require.cache[r2ServicePath] = {
    id: r2ServicePath,
    filename: r2ServicePath,
    loaded: true,
    exports: {
      async writeBuffer() {
        return null;
      },
      async deleteObject() {
        deleteCalls += 1;
        return null;
      },
      async createPresignedGet() {
        return 'https://r2.example.com/presigned';
      },
    },
  };

  require.cache[docupipeServicePath] = {
    id: docupipeServicePath,
    filename: docupipeServicePath,
    loaded: true,
    exports: {
      async postDocumentWithWorkflow() {
        return {
          initial: {
            jobId: 'job-upload-1',
            workflowResponse: {},
          },
          uploadJobId: 'job-upload-1',
          candidates: [
            {
              standardizationId: 'std-123',
              standardizationJobId: 'job-candidate-1',
            },
          ],
        };
      },
      async pollJob(jobId) {
        pollJobCalls.push(jobId);
        if (jobId === 'job-candidate-1') {
          const error = new Error(`DocuPipe job timeout: ${jobId}`);
          error.cause = { status: 404 };
          throw error;
        }
        if (jobId === 'job-upload-1') {
          return { jobId, status: 'completed', data: { status: 'completed' } };
        }
        throw new Error(`Unexpected jobId ${jobId}`);
      },
      async getStandardization(standardizationId) {
        return {
          schemaId: process.env.PAYSLIP_SCHEMA_ID,
          schemaName: 'Payslip (v1)',
          standardizationId,
          document: {
            schemaId: process.env.PAYSLIP_SCHEMA_ID,
            schemaName: 'Payslip (v1)',
            id: 'doc-789',
            payDate: '2024-01-31',
            period: { start: '2024-01-01', end: '2024-01-31' },
            gross: '1000',
            net: '800',
          },
        };
      },
      extractStandardizationCandidates() {
        return [];
      },
    },
  };

  let statusCode = null;
  let responseBody = null;

  try {
    // eslint-disable-next-line global-require
    const router = require(dashboardRoutePath);
    const uploadRoute = router.stack.find((layer) => layer.route?.path === '/documents');
    if (!uploadRoute) {
      throw new Error('Upload route not registered');
    }
    const handler = uploadRoute.route.stack[uploadRoute.route.stack.length - 1].handle;

    const req = {
      user: { id: 'user-123' },
      file: {
        buffer: Buffer.from('%PDF-1.4'),
        originalname: 'payslip.pdf',
        mimetype: 'application/pdf',
        size: 1024,
      },
    };

    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        responseBody = body;
        return this;
      },
    };

    await handler(req, res, (err) => {
      if (err) {
        throw err;
      }
    });

    assert.equal(statusCode, 201);
    assert.deepEqual(responseBody, {
      id: 'doc-result-1',
      type: 'payslip',
      standardizationId: 'std-123',
      documentId: 'doc-789',
      schemaId: process.env.PAYSLIP_SCHEMA_ID,
      schemaName: 'Payslip (v1)',
    });

    assert.deepEqual(pollJobCalls, ['job-candidate-1', 'job-upload-1']);
    assert.equal(deleteCalls, 0);
    assert.ok(documentResultPayload, 'expected document result payload to be created');
    assert.equal(documentResultPayload.finalJob.jobId, 'job-upload-1');
    assert.equal(documentResultPayload.status, 'completed');
  } finally {
    Module._resolveFilename = originalResolve;
    [
      expressStubPath,
      multerStubPath,
      path.resolve(__dirname, '__dayjsStub.js'),
      dashboardRoutePath,
      docupipeServicePath,
      r2ServicePath,
      uploadedDocumentPath,
      documentResultPath,
      modelsIndexPath,
    ].forEach((modulePath) => {
      delete require.cache[modulePath];
    });

    Object.entries(requiredEnv).forEach(([key]) => {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    });
  }

  console.log('dashboard docupipe fallback test passed');
}

run().catch((error) => {
  Module._resolveFilename = baseResolve;
  console.error(error);
  process.exitCode = 1;
});
