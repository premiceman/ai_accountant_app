import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPayslipMetricsV1 } from '../payslipMetrics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function loadFixture() {
  const fixturePath = resolve(
    __dirname,
    '../../../../src/services/insights/__tests__/fixtures/payslip_sep_2025.json'
  );
  const contents = await readFile(fixturePath, 'utf-8');
  return JSON.parse(contents);
}

(async () => {
  const fixture = await loadFixture();
  const metrics = buildPayslipMetricsV1(fixture);

  assert.equal(metrics.payDate, '2025-09-30');
  assert.deepEqual(metrics.period, { start: '2025-09-01', end: '2025-09-30', month: '2025-09' });
  assert.deepEqual(metrics.employer, { name: 'Coralogix UK Limited' });
  assert.equal(metrics.grossMinor, 1188010);
  assert.equal(metrics.netMinor, 605914);
  assert.equal(metrics.taxMinor, 417690);
  assert.equal(metrics.nationalInsuranceMinor, 39322);
  assert.equal(metrics.pensionMinor, 59400);
  assert.equal(metrics.studentLoanMinor, 80200);
  assert.equal(metrics.taxCode, 'K661M1');

  console.log('payslipMetrics.test passed');
})().catch((error) => {
  console.error('payslipMetrics.test failed', error);
  process.exitCode = 1;
});
