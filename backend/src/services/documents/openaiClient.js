const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let sharedClientPromise = null;

function resolveShared(relativePath) {
  const candidates = [
    path.resolve(__dirname, '../../../../shared', relativePath),
    path.resolve(__dirname, '../../../../../shared', relativePath),
    path.resolve(process.cwd(), 'shared', relativePath),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return pathToFileURL(candidate).href;
    }
  }
  throw new Error(`Unable to locate shared module: ${relativePath}`);
}

function loadSharedClient() {
  if (!sharedClientPromise) {
    sharedClientPromise = import(resolveShared('extraction/openaiClient.js'));
  }
  return sharedClientPromise;
}

async function callStructuredExtraction(prompt, schema, options = {}) {
  const module = await loadSharedClient();
  return module.callStructuredExtraction(prompt, schema, options);
}

async function callOpenAIJson(params) {
  const module = await loadSharedClient();
  if (!module.callOpenAIJson) {
    throw new Error('Shared OpenAI client does not expose callOpenAIJson');
  }
  return module.callOpenAIJson(params);
}

module.exports = {
  callStructuredExtraction,
  callOpenAIJson,
};
