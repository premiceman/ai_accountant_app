const assert = require('node:assert/strict');
const path = require('node:path');

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

  const modulePath = path.join(__dirname, '..', 'src', 'v2', 'services', 'docupipe.js');
  delete require.cache[require.resolve(modulePath)];

  const sequences = new Map();

  function enqueue(method, pathname, responses) {
    sequences.set(`${method} ${pathname}`, responses.slice());
  }

  function response({ status, body = '', ok }) {
    return {
      status,
      ok: ok !== undefined ? ok : status >= 200 && status < 300,
      text: async () => body,
    };
  }

  enqueue('POST', '/document', [
    response({
      status: 200,
      body: JSON.stringify({
        documentId: 'doc-123',
        jobId: 'job-upload',
        workflowResponse: {
          workflowId: 'wf-test',
          classifyStandardizeStep: {
            classificationJobId: 'job-classify',
            classToStandardizationIds: {
              classA: 'std-1',
              classB: 'std-2',
            },
            classToStandardizationJobIds: {
              classA: 'job-std-1',
              classB: 'job-std-2',
            },
          },
        },
      }),
    }),
  ]);

  enqueue('GET', '/job/job-upload', [
    response({
      status: 200,
      body: JSON.stringify({ status: 'completed' }),
    }),
  ]);

  enqueue('GET', '/job/job-classify', [
    response({
      status: 200,
      body: JSON.stringify({ status: 'completed' }),
    }),
  ]);

  enqueue('GET', '/job/job-std-1', [
    response({ status: 404, body: JSON.stringify({ detail: 'Job not found' }), ok: false }),
    response({
      status: 200,
      body: JSON.stringify({
        status: 'completed',
        result: {
          documents: [
            {
              documentType: 'payslip',
              classification: { name: 'Class A', key: 'classA' },
              schema: 'schema-a',
            },
          ],
        },
      }),
    }),
  ]);

  enqueue('GET', '/job/job-std-2', [
    response({
      status: 200,
      body: JSON.stringify({
        status: 'completed',
        result: {
          documents: [
            {
              documentType: 'statement',
              classification: { name: 'Class B', key: 'classB' },
              schema: 'schema-b',
            },
          ],
        },
      }),
    }),
  ]);

  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    const { pathname } = new URL(url);
    const key = `${method} ${pathname}`;
    const queue = sequences.get(key);
    if (!queue || queue.length === 0) {
      throw new Error(`Unexpected fetch for ${key}`);
    }
    return queue.shift();
  };

  try {
    // eslint-disable-next-line global-require
    const docupipe = require(modulePath);
    const result = await docupipe.runWorkflow({ fileUrl: 'https://example.com/doc.pdf' });

    assert.ok(result, 'runWorkflow should return a result');
    assert.equal(result.initialResponse.documentId, 'doc-123');

    assert.ok(Array.isArray(result.standardizations));
    assert.equal(result.standardizations.length, 2, 'expected two standardization entries');

    const [first, second] = result.standardizations;
    assert.equal(first.standardizationJobId, 'job-std-1');
    assert.equal(second.standardizationJobId, 'job-std-2');
    assert.equal(result.docupipe.standardizationJobs.length, 2);
    assert.equal(result.docupipe.status, 'completed');

    assert.ok(result.jobs.some((entry) => entry.type === 'upload'), 'upload job should be tracked');
    assert.ok(
      result.jobs.filter((entry) => entry.type === 'standardization').length >= 2,
      'all standardization jobs should be tracked'
    );

    assert.equal(result.data?.documents?.[0]?.documentType, 'payslip');

    const std1CallsRemaining = sequences.get('GET /job/job-std-1');
    assert.ok(std1CallsRemaining.length === 0, 'all queued responses for job-std-1 should be consumed');
  } finally {
    global.fetch = originalFetch;
    Object.entries(requiredEnv).forEach(([key]) => {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    });
    delete require.cache[require.resolve(modulePath)];
  }

  console.log('docupipeWorkflow tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
