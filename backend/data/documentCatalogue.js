// backend/data/documentCatalogue.js
// Shared catalogue of required evidence documents for HMRC workflows.
// This mirrors the required entries in the frontend catalogue so that
// backend services can reason about evidence coverage without duplicating
// the entire table rendering logic.

const REQUIRED_DOCUMENTS = [
  { key: 'proof_of_id',       label: 'Proof of ID',                                  cadence: { months: 60 } },
  { key: 'proof_of_address',  label: 'Proof of Address',                             cadence: { months: 6 } },
  { key: 'sa100_return_copy', label: 'SA100 Self Assessment (copy)',                 cadence: { yearlyBy: '01-31' } },
  { key: 'sa302_tax_calc',    label: 'SA302 / Tax Calculation',                      cadence: { yearlyBy: '01-31' } },
  { key: 'hmrc_statement',    label: 'HMRC Statement of Account',                    cadence: { yearlyBy: '01-31' } },
  { key: 'p60',               label: 'P60 End of Year Certificate',                  cadence: { yearlyBy: '06-01' } },
  { key: 'p11d',              label: 'P11D Benefits in Kind',                        cadence: { yearlyBy: '07-06' } },
  { key: 'pension_statement', label: 'Pension Annual Statement (SIPP/Workplace)',    cadence: { yearlyBy: '06-30' } },
  { key: 'pension_pia',       label: 'Pension Input Amounts (last 3 years)',         cadence: { yearlyBy: '06-30' } },
  { key: 'interest_certs',    label: 'Bank/Building Society Interest Certificates',  cadence: { yearlyBy: '06-30' } },
  { key: 'dividend_vouchers', label: 'Dividend Vouchers',                            cadence: { months: 12 } },
  { key: 'broker_tax_pack',   label: 'Broker Annual Tax Pack / CTC',                 cadence: { yearlyBy: '06-30' } },
  { key: 'trade_confirmations', label: 'Trade Confirmations / Contract Notes',       cadence: { months: 1 } },
  { key: 'crypto_history',    label: 'Crypto Full Trade History (CSV/API)',          cadence: { months: 1 } },
  { key: 'agent_statements',  label: 'Letting Agent Monthly Statements',             cadence: { months: 1 } },
  { key: 'mortgage_interest', label: 'Annual Mortgage Interest Certificate',         cadence: { yearlyBy: '05-31' } },
  { key: 'repairs_capital',   label: 'Repairs vs Capital Improvements Receipts',     cadence: { months: 1 } },
  { key: 'purchase_completion', label: 'Purchase Completion Statement',              cadence: { adhoc: true } },
  { key: 'sale_completion',   label: 'Sale Completion Statement',                    cadence: { adhoc: true } },
  { key: 'sdlt_return',       label: 'SDLT Return & Calculation',                    cadence: { adhoc: true } },
  { key: 'equity_grants',     label: 'RSU/ESPP/Option Grant Agreements & Schedules', cadence: { adhoc: true } },
  { key: 'equity_events',     label: 'Vest/Exercise/Sell Confirmations',             cadence: { months: 1 } },
  { key: 'gift_aid',          label: 'Gift Aid Donation Schedule & Receipts',        cadence: { months: 12 } },
];

module.exports = {
  REQUIRED_DOCUMENTS,
};
