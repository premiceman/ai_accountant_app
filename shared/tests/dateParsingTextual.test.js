const assert = require('node:assert/strict');
const path = require('node:path');

const dateParsingPath = path.resolve(__dirname, '../config/dateParsing.js');

function freshDateParsing() {
  delete require.cache[dateParsingPath];
  return require(dateParsingPath);
}

function assertMonthYearParsing(preference) {
  const dateParsing = freshDateParsing();
  assert.equal(
    dateParsing.parseDateString('Sep 2025', preference),
    '2025-09-01',
    `Expected default fallback for ${preference}`
  );
  assert.equal(
    dateParsing.parseDateString('September 2025', preference),
    '2025-09-01',
    `Expected full month name fallback for ${preference}`
  );
  assert.equal(
    dateParsing.parseDateString('Sep 2025', { preference, monthYearFallbackDay: '15' }),
    '2025-09-15',
    `Expected custom fallback for ${preference}`
  );

  const withoutFallback = dateParsing.parseDateString('Sep 2025', preference, {
    monthYearFallbackDay: null,
    returnMetadata: true,
  });
  assert.equal(withoutFallback.iso, null);
  assert(withoutFallback.metadata);
  assert.equal(withoutFallback.metadata.preference, preference);
  assert.equal(withoutFallback.metadata.format, 'textual');
  assert(withoutFallback.metadata.monthYear);
  assert.equal(withoutFallback.metadata.monthYear.month, '09');
  assert.equal(withoutFallback.metadata.monthYear.year, '2025');
  assert.equal(withoutFallback.metadata.monthYear.missingDay, true);

  const withMetadata = dateParsing.parseDateString('Sep 2025', preference, { returnMetadata: true });
  assert.equal(withMetadata.iso, '2025-09-01');
  assert(withMetadata.metadata.monthYear);
  assert.equal(withMetadata.metadata.monthYear.inferredDay, '01');
  assert.equal(withMetadata.metadata.monthYear.inference, 'fallback');
}

['DMY', 'MDY'].forEach(assertMonthYearParsing);

const dateParsing = freshDateParsing();
assert.equal(dateParsing.DEFAULT_MONTH_YEAR_FALLBACK_DAY, '01');

console.log('dateParsing textual month-year tests passed');
