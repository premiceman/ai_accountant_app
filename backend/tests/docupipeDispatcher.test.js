const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

process.env.NODE_PATH = path.join(__dirname, 'stubs');
Module._initPaths();

const r2Path = path.join(__dirname, '../src/lib/r2');
require.cache[require.resolve(r2Path)] = {
  exports: {
    getObject: async () => ({ Body: Buffer.from('') }),
    putObject: async () => {},
    deleteObject: async () => {},
    listObjects: async () => ({ Contents: [] }),
    buildObjectKey: () => 'stub',
    keyToFileId: (value) => value,
    fileIdToKey: (value) => value,
  },
};

const dispatcher = require('../src/services/vault/docupipeDispatcher');
const {
  prepareStandardizationResult,
} = dispatcher.__private__;

async function run() {
  const statementJob = { classification: { key: 'current_account_statement' } };
  const statementPayload = {
    data: {
      statement: {
        period: {
          Date: '30 November 2025',
        },
      },
    },
  };

  const statementResult = prepareStandardizationResult(statementJob, statementPayload);
  assert.ok(statementResult, 'expected statement result to be returned');
  assert.equal(
    statementResult.data.data.statement.period.Date,
    '11/2025',
    'expected statement period date to normalise to MM/YYYY'
  );
  assert.deepEqual(
    statementResult.missingRequiredFields,
    [],
    'statement should not require manual fields when period date present'
  );

  const missingStatement = prepareStandardizationResult(statementJob, { data: { statement: {} } });
  assert.deepEqual(
    missingStatement.missingRequiredFields,
    ['Period Date (MM/YYYY)'],
    'missing statement date should trigger manual requirement'
  );

  const payslipJob = { classification: { key: 'payslip' } };
  const payslipPayload = {
    data: {
      period: {
        Date: '2025-10-04',
      },
    },
  };

  const payslipResult = prepareStandardizationResult(payslipJob, payslipPayload);
  assert.equal(
    payslipResult.data.data.period.Date,
    '10/2025',
    'expected payslip period date to normalise to MM/YYYY'
  );
  assert.deepEqual(
    payslipResult.missingRequiredFields,
    [],
    'payslip should be considered complete when period date is available'
  );

  const payslipMissing = prepareStandardizationResult(payslipJob, { data: {} });
  assert.deepEqual(
    payslipMissing.missingRequiredFields,
    ['Period Date (MM/YYYY)'],
    'missing payslip date should trigger manual requirement'
  );

  console.log('docupipeDispatcher tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
