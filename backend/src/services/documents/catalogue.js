const catalogue = [
  { key: 'proof_of_id', label: 'Proof of ID', cadence: { months: 60 }, why: 'Verify identity (KYC/AML), protect account changes.', where: 'Passport or DVLA Driving Licence.', required: true },
  { key: 'proof_of_address', label: 'Proof of Address', cadence: { months: 6 }, why: 'Confirm UK residency for tax and correspondence.', where: 'Recent utility bill, bank/credit statement, council tax.', required: true },
  { key: 'sa100_return_copy', label: 'SA100 Self Assessment (copy)', cadence: { yearlyBy: '01-31' }, why: 'Record of filed return; carry-forwards, audit.', where: 'HMRC online → Self Assessment.', required: true },
  { key: 'sa302_tax_calc', label: 'SA302 / Tax Calculation', cadence: { yearlyBy: '01-31' }, why: 'Official calculation; supports mortgages/audit.', where: 'HMRC online → SA tax calculation.', required: true },
  { key: 'hmrc_statement', label: 'HMRC Statement of Account', cadence: { yearlyBy: '01-31' }, why: 'Shows balancing payment & payments on account.', where: 'HMRC online → SA account.', required: true },
  { key: 'p60', label: 'P60 End of Year Certificate', cadence: { yearlyBy: '06-01' }, why: 'Summary of pay & tax; essential for SA.', where: 'Employer/Payroll portal (by 31 May).', required: true },
  { key: 'p11d', label: 'P11D Benefits in Kind', cadence: { yearlyBy: '07-06' }, why: 'Taxable benefits (car, medical, etc.).', where: 'Employer/Payroll portal (by 6 July).', required: true },
  { key: 'p45', label: "P45 (leaver's certificate)", cadence: { adhoc: true }, why: 'Pay/tax to date when leaving a job.', where: 'Provided by former employer.', required: false },
  { key: 'payslips', label: 'Payslips (monthly)', cadence: { months: 1 }, why: 'Reconcile vs bank & P60/P11D.', where: 'Employer/Payroll portal.', required: false },
  { key: 'pension_statement', label: 'Pension Annual Statement (SIPP/Workplace)', cadence: { yearlyBy: '06-30' }, why: 'Tracks contributions (PIA) vs Annual Allowance.', where: 'Pension provider portal/annual pack.', required: true },
  { key: 'pension_pia', label: 'Pension Input Amounts (last 3 years)', cadence: { yearlyBy: '06-30' }, why: 'Needed for carry-forward and AA charges.', where: 'Pension schemes provide PIA per tax year.', required: true },
  { key: 'isa_statement', label: 'ISA Annual Statement', cadence: { yearlyBy: '05-31' }, why: 'Evidence of ISA subscriptions/limits.', where: 'ISA provider annual statement.', required: false },
  { key: 'interest_certs', label: 'Bank/Building Society Interest Certificates', cadence: { yearlyBy: '06-30' }, why: 'Declare savings interest beyond PSA.', where: 'Bank portals (tax certificates) or statements.', required: true },
  { key: 'dividend_vouchers', label: 'Dividend Vouchers', cadence: { months: 12 }, why: 'Evidence of dividend income & withholding.', where: 'Broker portal or registrar.', required: true },
  { key: 'broker_tax_pack', label: 'Broker Annual Tax Pack / CTC', cadence: { yearlyBy: '06-30' }, why: 'Summarises dividends, interest & disposals.', where: 'Broker portal (HL, AJ Bell, IBKR, etc.).', required: true },
  { key: 'trade_confirmations', label: 'Trade Confirmations / Contract Notes', cadence: { months: 1 }, why: 'Evidence of acquisitions/disposals & fees.', where: 'Broker portal (PDF/CSV).', required: true },
  { key: 'corp_actions', label: 'Corporate Actions Evidence', cadence: { adhoc: true }, why: 'Affects base cost (splits, rights, DRIP/scrip).', where: 'Broker notices/registrar.', required: false },
  { key: 'crypto_history', label: 'Crypto Full Trade History (CSV/API)', cadence: { months: 1 }, why: 'HMRC requires records; pooling; staking/airdrops.', where: 'Exchange CSV/API; wallet explorers; tax tools.', required: true },
  { key: 'tenancy_agreements', label: 'Tenancy Agreements (AST)', cadence: { adhoc: true }, why: 'Evidence of rental terms & periods let.', where: 'Lettings agent or signed AST.', required: false },
  { key: 'agent_statements', label: 'Letting Agent Monthly Statements', cadence: { months: 1 }, why: 'Income/fees records for SA property pages.', where: 'Agent portal/email statements.', required: true },
  { key: 'mortgage_interest', label: 'Annual Mortgage Interest Certificate', cadence: { yearlyBy: '05-31' }, why: 'Loan interest deduction evidence (rental).', where: 'Lender annual certificate.', required: true },
  { key: 'repairs_capital', label: 'Repairs vs Capital Improvements Receipts', cadence: { months: 1 }, why: 'Split revenue vs capital for SA & future CGT.', where: 'Contractor invoices/receipts.', required: true },
  { key: 'purchase_completion', label: 'Purchase Completion Statement', cadence: { adhoc: true }, why: 'Establishes base cost; incl. legal fees & SDLT.', where: 'Conveyancer/solicitor pack.', required: true },
  { key: 'sale_completion', label: 'Sale Completion Statement', cadence: { adhoc: true }, why: 'Proceeds & fees for CGT calculation.', where: 'Conveyancer/solicitor pack.', required: true },
  { key: 'sdlt_return', label: 'SDLT Return & Calculation', cadence: { adhoc: true }, why: 'Confirms SDLT paid and rates used.', where: 'Conveyancer or HMRC SDLT copy.', required: true },
  { key: 'equity_grants', label: 'RSU/ESPP/Option Grant Agreements & Schedules', cadence: { adhoc: true }, why: 'Defines vest/exercise terms; tax at vest.', where: 'Plan admin (Computershare/Equiniti/Fidelity).', required: true },
  { key: 'equity_events', label: 'Vest/Exercise/Sell Confirmations', cadence: { months: 1 }, why: 'Taxed amounts at vest/exercise; basis updates.', where: 'Plan/Broker statements.', required: true },
  { key: 'gift_aid', label: 'Gift Aid Donation Schedule & Receipts', cadence: { months: 12 }, why: 'Gross-up claims in SA; higher rate relief.', where: 'Charity statements; CAF reports.', required: true },
  { key: 'gifts_log', label: 'Gifts Log (7-year IHT tracking)', cadence: { months: 12 }, why: 'Track annual exemptions & PETs for IHT.', where: 'Self-maintained log with evidence.', required: false },
  { key: 'student_loans', label: 'Student/Postgrad Loan Statements', cadence: { yearlyBy: '04-30' }, why: 'Plan type and balance; check PAYE/SA deductions.', where: 'SLC online account.', required: false },
  { key: 'child_benefit', label: 'Child Benefit Award & Payments', cadence: { months: 12 }, why: 'Assess HICBC if income exceeds thresholds.', where: 'GOV.UK child benefit service.', required: false },
  { key: 'marriage_allowance', label: 'Marriage Allowance Transfer Confirmation', cadence: { yearlyBy: '01-31' }, why: 'Impacts personal allowance transfer between spouses.', where: 'GOV.UK marriage allowance service.', required: false }
];

const catalogueByKey = new Map(catalogue.map(item => [item.key, item]));
const requiredKeys = catalogue.filter(item => item.required).map(item => item.key);
const helpfulKeys = catalogue.filter(item => !item.required).map(item => item.key);

function getCatalogue() {
  return catalogue;
}

function getCatalogueEntry(key) {
  return catalogueByKey.get(String(key || '')) || null;
}

function getRequiredKeys() {
  return requiredKeys;
}

function getHelpfulKeys() {
  return helpfulKeys;
}

function summarizeCatalogue(perFileInput = {}) {
  const perFile = {};
  if (perFileInput && typeof perFileInput === 'object') {
    for (const [fileId, info] of Object.entries(perFileInput)) {
      if (!info || typeof info !== 'object') continue;
      const key = info.key;
      if (!catalogueByKey.has(key)) continue;
      perFile[fileId] = {
        key,
        collectionId: info.collectionId || null,
        uploadedAt: info.uploadedAt || null,
        name: info.name || null,
        size: Number.isFinite(info.size) ? info.size : Number(info.size) || 0,
      };
    }
  }

  const perKey = {};
  for (const [fileId, info] of Object.entries(perFile)) {
    const entry = perKey[info.key] || { files: [] };
    entry.files.push({
      id: fileId,
      collectionId: info.collectionId,
      uploadedAt: info.uploadedAt,
      name: info.name,
      size: info.size,
    });
    perKey[info.key] = entry;
  }

  for (const entry of Object.values(perKey)) {
    entry.files.sort((a, b) => {
      const aDate = a.uploadedAt || '';
      const bDate = b.uploadedAt || '';
      return bDate.localeCompare(aDate);
    });
    entry.latestFileId = entry.files[0]?.id || null;
    entry.latestUploadedAt = entry.files[0]?.uploadedAt || null;
  }

  const requiredCompleted = requiredKeys.filter(key => perKey[key]?.latestUploadedAt).length;
  const helpfulCompleted = helpfulKeys.filter(key => perKey[key]?.latestUploadedAt).length;

  return { perFile, perKey, requiredCompleted, helpfulCompleted };
}

module.exports = {
  catalogue,
  getCatalogue,
  getCatalogueEntry,
  getRequiredKeys,
  getHelpfulKeys,
  summarizeCatalogue,
};
