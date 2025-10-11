const assert = require('node:assert/strict');
const path = require('node:path');

const dateParsingPath = path.resolve(__dirname, '../config/dateParsing.js');

function loadDateParsing() {
  delete require.cache[dateParsingPath];
  return require(dateParsingPath);
}

function resetDefaultDayEnv(value) {
  if (value == null) {
    delete process.env.DATE_PARSE_DEFAULT_DAY;
  } else {
    process.env.DATE_PARSE_DEFAULT_DAY = value;
  }
}

async function run() {
  resetDefaultDayEnv(null);
  let dateParsing = loadDateParsing();
  assert.equal(dateParsing.parseDateString('Sep 2025'), '2025-09-01');
  assert.equal(dateParsing.parseDateString('Sept 2025'), '2025-09-01');
  assert.equal(dateParsing.parseDateString('10 Sep 2025'), '2025-09-10');

  resetDefaultDayEnv('15');
  dateParsing = loadDateParsing();
  assert.equal(dateParsing.parseDateString('Sep 2025'), '2025-09-15');
  assert.equal(dateParsing.parseDateString('10 Sep 2025'), '2025-09-10');

  console.log('dateParsing textual tests passed');
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    resetDefaultDayEnv(null);
    delete require.cache[dateParsingPath];
  });
