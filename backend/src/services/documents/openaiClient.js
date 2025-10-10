let sharedClientPromise = null;

function loadSharedClient() {
  if (!sharedClientPromise) {
    sharedClientPromise = import('../../../../shared/extraction/openaiClient.js');
  }
  return sharedClientPromise;
}

async function callStructuredExtraction(prompt, schema, options = {}) {
  const module = await loadSharedClient();
  return module.callStructuredExtraction(prompt, schema, options);
}

module.exports = {
  callStructuredExtraction,
};
