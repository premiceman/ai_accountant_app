const assert = require('node:assert/strict');

const { normaliseDateFields } = require('../src/services/documents/dateFieldNormaliser');

async function run() {
  const basic = { Date: '2024-05-25' };
  normaliseDateFields(basic);
  assert.equal(basic.Date, '05/2024', 'expected ISO string to become MM/YYYY');

  const nested = { items: [{ Date: '15/03/2023' }, { Date: '03-2022' }] };
  normaliseDateFields(nested);
  assert.equal(nested.items[0].Date, '03/2023', 'expected UK formatted date to normalise');
  assert.equal(nested.items[1].Date, '03/2022', 'expected already normalised date to be preserved');

  const invalid = { Date: 'not a date' };
  normaliseDateFields(invalid);
  assert.equal(invalid.Date, 'not a date', 'invalid date strings should remain unchanged');

  const unaffected = { updatedAt: '2024-05-25' };
  normaliseDateFields(unaffected);
  assert.equal(unaffected.updatedAt, '2024-05-25', 'non-"Date" keys should not be touched');

  console.log('dateFieldNormaliser test passed');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
