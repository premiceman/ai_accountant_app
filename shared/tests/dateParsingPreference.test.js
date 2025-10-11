const assert = require('node:assert/strict');
const path = require('node:path');

const openaiClientPath = path.resolve(__dirname, '../extraction/openaiClient.js');
const originalOpenaiCache = require.cache[openaiClientPath];
const originalPreference = process.env.DATE_PARSE_PREFERENCE;
const originalOrder = process.env.DATE_PARSE_ORDER;

const stubResponses = {
  payslip_analysis: {
    gross_pay: { period: 1200, ytd: 7200 },
    net_pay: { period: 900, ytd: 5400 },
    statutory: {
      income_tax: 200,
      national_insurance: 100,
      pension: 50,
      student_loan: null,
    },
    payment_date: '04/05/2024',
    period_start: '02/05/2024',
    period_end: '04/05/2024',
    pay_frequency: 'Monthly',
    tax_code: '1257L',
    notes: ['Sample note'],
    employee_name: 'Alex Employee',
    employer_name: 'Acme Ltd',
  },
  statement_extraction: {
    bank_name: 'Sample Bank',
    account_number: '123456',
    account_type: 'Current Account',
    account_holder: 'Alex Employee',
    statement_period: {
      start_date: '04/05/2024',
      end_date: '06/05/2024',
    },
    transactions: [
      { date: '06/05/2024', description: 'Supermarket', amount: -45.67, category: 'Groceries' },
      { date: '05/05/2024', description: 'Salary', amount: 2000, category: 'Income' },
    ],
    totals: { income: 2000, spend: 45.67 },
  },
  transaction_categorisation: {
    categories: [
      { index: 0, category: 'Groceries' },
      { index: 1, category: 'Income' },
    ],
  },
};

require.cache[openaiClientPath] = {
  id: openaiClientPath,
  filename: openaiClientPath,
  loaded: true,
  exports: {
    async callStructuredExtraction(_prompt, schema) {
      const name = schema?.name;
      if (name && stubResponses[name]) {
        return stubResponses[name];
      }
      return null;
    },
  },
};

const payslipPath = path.resolve(__dirname, '../extraction/payslip.js');
const statementPath = path.resolve(__dirname, '../extraction/statement.js');
const dateParsingPath = path.resolve(__dirname, '../config/dateParsing.js');

async function runScenario(preference) {
  if (preference) {
    process.env.DATE_PARSE_PREFERENCE = preference;
    process.env.DATE_PARSE_ORDER = preference;
  } else {
    delete process.env.DATE_PARSE_PREFERENCE;
    delete process.env.DATE_PARSE_ORDER;
  }

  delete require.cache[dateParsingPath];
  delete require.cache[payslipPath];
  delete require.cache[statementPath];

  const dateParsing = require(dateParsingPath);
  const payslipModule = require(payslipPath);
  const statementModule = require(statementPath);

  const expectedPayDate = dateParsing.parseDateString('04/05/2024');
  const expectedPeriodStart = dateParsing.parseDateString('02/05/2024');
  const expectedPeriodEnd = dateParsing.parseDateString('04/05/2024');
  const expectedStatementStart = dateParsing.parseDateString('04/05/2024');
  const expectedStatementEnd = dateParsing.parseDateString('06/05/2024');
  const textualDate = dateParsing.parseDateString('30TH September 2025');

  const payslip = await payslipModule.analysePayslip(
    'Pay Date: 04/05/2024\nPeriod Start: 02/05/2024\nPeriod End: 04/05/2024\nGross Pay £1200\nNet Pay £900'
  );
  assert.equal(payslip.payDate, expectedPayDate);
  assert.equal(payslip.periodStart, expectedPeriodStart);
  assert.equal(payslip.periodEnd, expectedPeriodEnd);

  const statement = await statementModule.analyseCurrentAccountStatement(
    'Sample Bank Statement\n06/05/2024 Supermarket -45.67\n05/05/2024 Salary 2000.00'
  );
  assert.equal(statement.metadata.period.start, expectedStatementStart);
  assert.equal(statement.metadata.period.end, expectedStatementEnd);
  assert.equal(statement.transactions[0].date, expectedStatementEnd);
  assert.equal(textualDate, '2025-09-30');
}

async function run() {
  await runScenario('DMY');
  await runScenario('MDY');
  console.log('dateParsing preference tests passed');
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    delete require.cache[payslipPath];
    delete require.cache[statementPath];
    delete require.cache[dateParsingPath];
    if (originalOpenaiCache) {
      require.cache[openaiClientPath] = originalOpenaiCache;
    } else {
      delete require.cache[openaiClientPath];
    }
    if (originalPreference == null) {
      delete process.env.DATE_PARSE_PREFERENCE;
    } else {
      process.env.DATE_PARSE_PREFERENCE = originalPreference;
    }
    if (originalOrder == null) {
      delete process.env.DATE_PARSE_ORDER;
    } else {
      process.env.DATE_PARSE_ORDER = originalOrder;
    }
  });
