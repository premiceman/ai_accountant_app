const assert = require('node:assert/strict');

const { parseDateString } = require('../config/dateParsing');

function run() {
  const lowerCaseMonth = parseDateString('30TH September 2025');
  assert.equal(lowerCaseMonth, '2025-09-30');

  const upperCaseMonth = parseDateString('15TH OCTOBER 2024');
  assert.equal(upperCaseMonth, '2024-10-15');

  console.log('dateParsing textual month tests passed');
}

run();
