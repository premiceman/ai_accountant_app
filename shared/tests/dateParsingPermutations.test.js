const assert = require('node:assert/strict');
const path = require('node:path');

const dateParsingPath = path.resolve(__dirname, '../config/dateParsing.js');

function freshDateParsing() {
  delete require.cache[dateParsingPath];
  return require(dateParsingPath);
}

const permutations = [
  ['30th September 2025', '2025-09-30'],
  ['30THSeptember2025', '2025-09-30'],
  ['30thSep2025', '2025-09-30'],
  ['30THSep25', '2025-09-30'],
  ['30 Sep 25', '2025-09-30'],
  ['30 September25', '2025-09-30'],
  ['30th/September/2025', '2025-09-30'],
  ['30th-September-25', '2025-09-30'],
  ['30September2025', '2025-09-30'],
  ['September 2025', '2025-09-01'],
  ['September2025', '2025-09-01'],
  ['2025September', '2025-09-01'],
  ['Sep 2025', '2025-09-01'],
  ['Sep2025', '2025-09-01'],
  ['Sep/2025', '2025-09-01'],
  ['09/2025', '2025-09-01'],
  ['2025/09', '2025-09-01'],
  ['2025-09', '2025-09-01'],
  ['09-25', '2025-09-01'],
];

['DMY', 'MDY'].forEach((preference) => {
  const dateParsing = freshDateParsing();
  permutations.forEach(([input, expected]) => {
    const actual = dateParsing.parseDateString(input, preference);
    assert.equal(
      actual,
      expected,
      `Expected ${input} -> ${expected} for ${preference}, received ${actual}`
    );
  });

  const metadata = dateParsing.parseDateString('09/2025', preference, {
    monthYearFallbackDay: null,
    returnMetadata: true,
  });
  assert.equal(metadata.iso, null);
  assert(metadata.metadata);
  assert.equal(metadata.metadata.format, 'numeric');
  assert(metadata.metadata.monthYear);
  assert.equal(metadata.metadata.monthYear.month, '09');
  assert.equal(metadata.metadata.monthYear.year, '2025');
  assert.equal(metadata.metadata.monthYear.missingDay, true);
});

console.log('dateParsing permutation tests passed');
