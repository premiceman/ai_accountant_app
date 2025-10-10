// services/worker/src/shared/extraction.ts
// Purpose: robust, environment-agnostic dynamic imports for shared extractors.
// Works in dev (ts-node-dev), local build (node dist), and Docker.
// Do not change public function signatures.

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
  period: { start: string | null; end: string | null };
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

// Use absolute file:// URLs based on the current module’s URL.
// This avoids fragile relative pathing in dev vs dist vs Docker.
const PAYSLIP_MODULE_URL   = new URL('../../../../shared/extraction/payslip.js', import.meta.url).href;
const STATEMENT_MODULE_URL = new URL('../../../../shared/extraction/statement.js', import.meta.url).href;

let payslipModulePromise: Promise<any> | null = null;
let statementModulePromise: Promise<any> | null = null;

function loadPayslipModule() {
  if (!payslipModulePromise) {
    payslipModulePromise = import(PAYSLIP_MODULE_URL);
  }
  return payslipModulePromise;
}

function loadStatementModule() {
  if (!statementModulePromise) {
    statementModulePromise = import(STATEMENT_MODULE_URL);
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
