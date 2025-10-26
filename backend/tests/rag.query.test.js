const test = require('node:test');
const assert = require('node:assert/strict');

global.fetch = async (url, options) => {
  if (url.includes('/vector_stores/') && url.endsWith('/query')) {
    return {
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ data: [{ file_id: 'f1', content: 'chunk text', score: 0.9, metadata: { page: 2 } }] }),
    };
  }
  throw new Error('Unexpected fetch: ' + url);
};

process.env.OPENAI_API_KEY = 'test-key';

const { rag } = require('../utils/openai');

test('rag query normalises results', async () => {
  const items = await rag.query({ vectorStoreId: 'vs_123', query: 'hello' });
  assert.equal(items.length, 1);
  assert.deepEqual(items[0], { fileId: 'f1', page: 2, text: 'chunk text', score: 0.9 });
});
