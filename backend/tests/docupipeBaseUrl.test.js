const assert = require('node:assert/strict');
const path = require('node:path');

const modulePath = path.join(__dirname, '..', 'src', 'config', 'docupipe');

function loadConfig() {
  delete require.cache[require.resolve(modulePath)];
  // eslint-disable-next-line global-require
  return require(modulePath);
}

async function run() {
  const original = process.env.DOCUPIPE_BASE_URL;
  const originalWorkflow = process.env.DOCUPIPE_WORKFLOW_ID;
  try {
    process.env.DOCUPIPE_WORKFLOW_ID = 'wf-test';
    delete process.env.DOCUPIPE_BASE_URL;
    let config = loadConfig();
    assert.equal(config.DOCUPIPE_BASE_URL, 'https://app.docupipe.ai');
    assert.equal(
      config.docupipeUrl(`/workflows/${config.DOCUPIPE_WORKFLOW_ID}/dispatch`).startsWith(
        'https://app.docupipe.ai/workflows/'
      ),
      true
    );

    process.env.DOCUPIPE_BASE_URL = 'https://custom.example.com/workflows/abc';
    config = loadConfig();
    assert.equal(config.DOCUPIPE_BASE_URL, 'https://custom.example.com');

    process.env.DOCUPIPE_BASE_URL = 'not-a-valid-url';
    assert.throws(() => loadConfig(), /Invalid URL/);

    console.log('docupipeBaseUrl tests passed');
  } finally {
    if (originalWorkflow === undefined) {
      delete process.env.DOCUPIPE_WORKFLOW_ID;
    } else {
      process.env.DOCUPIPE_WORKFLOW_ID = originalWorkflow;
    }
    if (original === undefined) {
      delete process.env.DOCUPIPE_BASE_URL;
    } else {
      process.env.DOCUPIPE_BASE_URL = original;
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
