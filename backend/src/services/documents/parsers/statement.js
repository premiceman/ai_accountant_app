let sharedModulePromise = null;

function loadSharedModule() {
  if (!sharedModulePromise) {
    sharedModulePromise = import('../../../../shared/extraction/statement.js');
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
