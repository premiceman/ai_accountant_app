const assert = require('node:assert/strict');
const path = require('node:path');

async function run() {
  const modulePath = path.resolve(__dirname, '../extraction/extractPdfText.js');
  delete require.cache[modulePath];
  const extractor = require(modulePath);
  const { extractPdfText, __private__ } = extractor;

  __private__.setTestOverrides({
    async loadPdfParse() {
      return async () => {
        throw new Error('pdf-parse missing');
      };
    },
    async runOcr() {
      return 'Page one text\n\nPage two text';
    },
  });

  const result = await extractPdfText(Buffer.from('dummy-pdf'));
  assert.deepEqual(result.pages, ['Page one text', 'Page two text']);
  assert.equal(result.fullText, 'Page one text\n\nPage two text');

  __private__.resetTestState();
  console.log('extractPdfText fallback test passed');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
