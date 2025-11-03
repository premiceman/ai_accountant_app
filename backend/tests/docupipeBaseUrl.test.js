const assert = require('node:assert/strict');
const { resolveDocupipeBaseUrl, DEFAULT_DOCUPIPE_BASE_URL } = require('../../shared/config/docupipe');

async function run() {
  const original = process.env.DOCUPIPE_BASE_URL;
  try {
    delete process.env.DOCUPIPE_BASE_URL;
    const defaultUrl = resolveDocupipeBaseUrl(process.env);
    assert.equal(defaultUrl, DEFAULT_DOCUPIPE_BASE_URL);

    const custom = resolveDocupipeBaseUrl({ DOCUPIPE_BASE_URL: 'https://custom.example.com/' });
    assert.equal(custom, 'https://custom.example.com');

    assert.throws(
      () => resolveDocupipeBaseUrl({ DOCUPIPE_BASE_URL: 'not-a-valid-url' }),
      /DOCUPIPE_BASE_URL "not-a-valid-url" is not a valid absolute URL/i
    );

    console.log('docupipeBaseUrl tests passed');
  } finally {
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
