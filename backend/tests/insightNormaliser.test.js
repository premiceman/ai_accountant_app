const test = require('node:test');
const assert = require('node:assert/strict');

const { normaliseDocumentInsight } = require('../src/services/documents/insightNormaliser');

test('normalises payslip totals and line items', () => {
  const raw = {
    baseKey: 'payslip',
    metrics: {
      gross: '£3,000.50',
      net: '£2,200.25',
      tax: '£600.10',
      ni: '£200.15',
      pension: '£100.00',
      studentLoan: '0',
      earnings: [
        { label: 'Basic Pay', amount: '£2,500.25' },
        { label: 'Bonus', amount: '£500.25' },
      ],
      deductions: [
        { label: 'Tax', amount: '(£600.10)' },
        { label: 'NI', amount: '£200.15' },
        { label: 'Pension', amount: '£100.00' },
      ],
      allowances: [{ label: 'Travel', amount: '£50.00' }],
      payDate: '2024-05-31',
      periodStart: '2024-05-01',
      periodEnd: '2024-05-31',
      payFrequency: 'Monthly',
      taxCode: '1257L',
    },
    metadata: {
      employerName: 'Example Co',
    },
  };

  const result = normaliseDocumentInsight(raw);

  assert.equal(result.metrics.gross, 3000.5);
  assert.equal(result.metrics.net, 2200.25);
  assert.equal(result.metrics.totalDeductions, 900.25);
  assert.equal(result.metrics.earnings.length, 2);
  assert.equal(result.metrics.deductions.length, 3);
  assert.equal(result.metrics.earnings[0].amount, 2500.25);
  assert.equal(result.metrics.deductions[1].amount, 200.15);
  assert.equal(result.metadata.payDate, '2024-05-31');
  assert.equal(result.metadata.period.start, '2024-05-01');
  assert.equal(result.metadata.period.end, '2024-05-31');
  assert.equal(result.metadata.period.month, '2024-05');
  assert.equal(result.metricsV1.grossMinor, 300050);
  assert.equal(result.metricsV1.netMinor, 220025);
  assert.equal(result.metricsV1.taxMinor, 60010);
  assert.equal(result.metricsV1.nationalInsuranceMinor, 20015);
  assert.equal(result.metricsV1.pensionMinor, 10000);
  assert.equal(result.metricsV1.studentLoanMinor, 0);
});

test('manual edits recompute derived payslip metrics', () => {
  const base = {
    baseKey: 'payslip',
    metrics: {
      gross: 3200,
      net: 2400,
      tax: 650,
      ni: 210,
      pension: 90,
      deductions: [
        { label: 'Tax', amount: 650 },
        { label: 'NI', amount: 210 },
        { label: 'Pension', amount: 90 },
      ],
      payDate: '2024-06-30',
      payFrequency: 'Monthly',
    },
    metadata: {},
  };

  const first = normaliseDocumentInsight(base);
  assert.equal(first.metrics.totalDeductions, 950);
  assert.ok(first.metrics.takeHomePercent > 0);

  const edited = normaliseDocumentInsight({
    ...base,
    metrics: {
      ...base.metrics,
      net: 2500,
      deductions: [
        { label: 'Tax', amount: 600 },
        { label: 'NI', amount: 220 },
        { label: 'Pension', amount: 80 },
      ],
    },
  });

  assert.equal(edited.metrics.totalDeductions, 900);
  assert.equal(edited.metrics.net, 2500);
  assert.notEqual(edited.metrics.totalDeductions, first.metrics.totalDeductions);
  assert.notEqual(edited.metrics.takeHomePercent, first.metrics.takeHomePercent);
  assert.equal(edited.metadata.documentMonth, '2024-06');
  assert.equal(edited.metricsV1.netMinor, 250000);
});
