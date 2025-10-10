let sharedModulePromise = null;

function loadSharedModule() {
  if (!sharedModulePromise) {
    sharedModulePromise = import('../../../../shared/extraction/payslip.js');
  }
  return sharedModulePromise;
}

async function analysePayslip(text) {
  const module = await loadSharedModule();
  return module.analysePayslip(text);
}

module.exports = {
  analysePayslip,
};
