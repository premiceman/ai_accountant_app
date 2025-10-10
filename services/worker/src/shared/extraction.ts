type PayslipExtractionResult = {
  payDate: string;
  period?: { start?: string | null; end?: string | null; month?: string | null };
  employer?: string | null;
  gross?: number | null;
  net?: number | null;
  tax?: number | null;
  ni?: number | null;
  pension?: number | null;
  studentLoan?: number | null;
  payFrequency?: string | null;
};

type StatementExtractionResult = {
  bankName?: string | null;
  accountNumberMasked?: string | null;
  accountType?: string | null;
  period: { start: string; end: string; month?: string };
  openingBalance?: number | null;
  closingBalance?: number | null;
  inflows?: number | null;
  outflows?: number | null;
  transactions: Array<{
    date: string;
    description: string;
    amount: number;
    direction?: 'inflow' | 'outflow';
    category?: string | null;
  }>;
};

const PAYSLIP_MODULE: string = '../../../../shared/extraction/payslip.js';
const STATEMENT_MODULE: string = '../../../../shared/extraction/statement.js';

let payslipModulePromise: Promise<any> | null = null;
let statementModulePromise: Promise<any> | null = null;

function loadPayslipModule() {
  if (!payslipModulePromise) {
    payslipModulePromise = import(PAYSLIP_MODULE) as Promise<any>;
  }
  return payslipModulePromise;
}

function loadStatementModule() {
  if (!statementModulePromise) {
    statementModulePromise = import(STATEMENT_MODULE) as Promise<any>;
  }
  return statementModulePromise;
}

export async function extractPayslip(buffer: Buffer): Promise<PayslipExtractionResult> {
  const mod = (await loadPayslipModule()) as {
    extractPayslip(buffer: Buffer): Promise<PayslipExtractionResult>;
  };
  return mod.extractPayslip(buffer);
}

export async function extractStatement(buffer: Buffer): Promise<StatementExtractionResult> {
  const mod = (await loadStatementModule()) as {
    extractStatement(buffer: Buffer): Promise<StatementExtractionResult>;
  };
  return mod.extractStatement(buffer);
}
