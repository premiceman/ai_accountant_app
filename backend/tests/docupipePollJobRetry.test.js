const assert = require('node:assert/strict');
const path = require('node:path');

const configPath = path.join(__dirname, '..', 'src', 'v2', 'config.js');
const originalConfig = require.cache[configPath];
require.cache[configPath] = {
  id: configPath,
  filename: configPath,
  loaded: true,
  exports: {
    config: {
      docupipe: {
        apiKey: 'test-key',
        baseUrl: 'https://docupipe.test',
        workflowId: 'wf-test',
        dataset: 'invoices',
        connectTimeoutMs: 50,
        pollIntervalMs: 1,
        pollTimeoutMs: 50,
      },
    },
  },
};

const docupipePath = path.join(__dirname, '..', 'src', 'v2', 'services', 'docupipe.js');
delete require.cache[docupipePath];

async function run() {
  const originalFetch = global.fetch;
  let fetchCalls = 0;

  global.fetch = async () => {
    fetchCalls += 1;
    if (fetchCalls === 1) {
      return {
        ok: false,
        status: 404,
        text: async () => 'not found',
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ status: 'completed' }),
    };
  };

  try {
    const { pollJob } = require(docupipePath);
    const job = await pollJob('job-123', { intervalMs: 1, timeoutMs: 50 });

    assert.equal(job.status, 'completed');
    assert.equal(fetchCalls, 2, 'expected pollJob to retry after initial 404');
    console.log('docupipe poll job retry tests passed');
  } finally {
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      delete global.fetch;
    }
    delete require.cache[docupipePath];
    if (originalConfig) {
      require.cache[configPath] = originalConfig;
    } else {
      delete require.cache[configPath];
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
