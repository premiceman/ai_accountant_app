// backend/data/vaultCatalogue.js
// Canonical catalogue of documents used by the vault UI and downstream services.

const DOCS = [
  {
    key: 'payslip',
    label: 'Payslip',
    cadence: { months: 1 },
    why: 'Confirms monthly earnings, deductions and pension contributions.',
    where: 'Employer or payroll portal PDF export.',
    required: true,
    aliases: ['payslip', 'pay slip', 'salary slip'],
    categories: ['required', 'analytics']
  },
  {
    key: 'current_account_statement',
    label: 'Current account statement',
    cadence: { months: 1 },
    why: 'Classifies income and spending for dashboards.',
    where: 'Download monthly PDF/CSV statement from your bank.',
    required: true,
    aliases: ['bank statement', 'current account', 'checking statement'],
    categories: ['required', 'analytics']
  },
  {
    key: 'savings_account_statement',
    label: 'Savings account statement',
    cadence: { months: 1 },
    why: 'Tracks savings balances, inflows and interest.',
    where: 'Savings or cash ISA provider statements.',
    required: false,
    aliases: ['savings statement', 'saver statement'],
    categories: ['analytics', 'helpful']
  },
  {
    key: 'isa_statement',
    label: 'ISA statement',
    cadence: { yearlyBy: '04-30' },
    why: 'Evidence ISA contributions and performance for wealth lab.',
    where: 'Stocks & shares or cash ISA annual statement.',
    required: false,
    aliases: ['isa', 'isa annual statement'],
    categories: ['analytics', 'helpful']
  },
  {
    key: 'pension_statement',
    label: 'Pension contribution statement',
    cadence: { yearlyBy: '04-30' },
    why: 'Provides pension input amounts for tax relief calculations.',
    where: 'Workplace pension or SIPP provider.',
    required: true,
    aliases: ['pension statement', 'annual pension statement'],
    categories: ['required', 'helpful']
  },
  {
    key: 'hmrc_correspondence',
    label: 'HMRC correspondence (SA302, statements, coding notices)',
    cadence: { yearlyBy: '01-31' },
    why: 'Supports tax lab balances and filing reminders.',
    where: 'HMRC online account downloads.',
    required: true,
    aliases: ['sa302', 'tax calculation', 'hmrc statement'],
    categories: ['required']
  },
  {
    key: 'supporting_receipts',
    label: 'Supporting receipts & schedules',
    cadence: { months: 1 },
    why: 'Additional context for deductions, expenses and scenario planning.',
    where: 'Upload scans or CSV exports of relevant receipts.',
    required: false,
    aliases: ['receipt', 'schedule', 'expense receipt'],
    categories: ['helpful']
  }
];

module.exports = {
  DOCS,
  requiredDocs: DOCS.filter((d) => d.required),
  helpfulDocs: DOCS.filter((d) => !d.required),
};
