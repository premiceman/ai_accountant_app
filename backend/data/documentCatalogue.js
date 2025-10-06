// backend/data/documentCatalogue.js
// Shared catalogue of required evidence documents for HMRC workflows.
// This mirrors the required entries in the frontend catalogue so that
// backend services can reason about evidence coverage without duplicating
// the entire table rendering logic.

const REQUIRED_DOCUMENTS = [
  { key: 'payslip',                   label: 'Payslip',                               cadence: { months: 1 } },
  { key: 'current_account_statement', label: 'Current account statement',            cadence: { months: 1 } },
  { key: 'pension_statement',         label: 'Pension contribution statement',       cadence: { yearlyBy: '04-30' } },
  { key: 'hmrc_correspondence',       label: 'HMRC correspondence (SA302, notices)', cadence: { yearlyBy: '01-31' } },
];

module.exports = {
  REQUIRED_DOCUMENTS,
};
