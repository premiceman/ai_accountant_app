const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let sharedModulePromise = null;

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

function loadSharedModule() {
  if (!sharedModulePromise) {
    sharedModulePromise = import(resolveShared('extraction/statement.js'));
  }
  return sharedModulePromise;
}

async function analyseCurrentAccountStatement(text) {
  const module = await loadSharedModule();
  return module.analyseCurrentAccountStatement(text);
}

module.exports = {
  analyseCurrentAccountStatement,
};
