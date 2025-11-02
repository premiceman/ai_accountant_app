const { compile } = require('./index');
const { payslipSchema } = require('../schemas/payslip.v2');
const { statementSchema } = require('../schemas/statement.v2');
const { transactionSchema } = require('../schemas/transaction.v2');

const validatePayslip = compile('payslip.v2', payslipSchema);
const validateStatement = compile('statement.v2', statementSchema);
const validateTransaction = compile('transaction.v2', transactionSchema);

module.exports = {
  validatePayslip,
  validateStatement,
  validateTransaction,
};
