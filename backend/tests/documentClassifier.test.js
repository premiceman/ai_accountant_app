const test = require('node:test');
const assert = require('node:assert/strict');

const Module = require('module');
const originalLoad = Module._load;
Module._load = function patchedLoader(request, parent, isMain) {
  if (request === 'pdf-parse') {
    return async (buffer) => ({ text: Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer || '') });
  }
  if (request === 'dayjs') {
    const stub = (value) => ({
      isValid: () => true,
      toISOString: () => new Date().toISOString(),
      format: () => '2024-01',
    });
    stub.extend = () => {};
    stub.isDayjs = true;
    return stub;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { classifyDocument } = require('../src/services/documents/ingest');

Module._load = originalLoad;

const payslipText = `
ACME CORPORATION PAYSLIP
Employee: Jane Doe
Tax Code: 1257L
Gross Pay £4,200.00
Net Pay £3,100.00
National Insurance £350.00
`;

const statementText = `
Monthly Statement
Account Number: 12345678
Sort Code: 12-34-56
Transaction Details
Closing balance £12,345.67
`;

test('classifyDocument identifies payslip heuristics', () => {
  const result = classifyDocument({ text: payslipText, originalName: 'jan-2024-payslip.pdf' });
  assert.equal(result.key, 'payslip');
  assert.ok(result.confidence > 0);
});

test('classifyDocument identifies bank statement heuristics', () => {
  const result = classifyDocument({ text: statementText, originalName: 'statement.pdf' });
  assert.equal(result.key, 'current_account_statement');
});

test('classifyDocument returns null when no match', () => {
  const result = classifyDocument({ text: 'random document without hints', originalName: 'notes.txt' });
  assert.equal(result.key, null);
  assert.equal(result.confidence, 0);
});
