// services/worker/src/shared/extraction.ts
// Purpose: robust, environment-agnostic dynamic imports for shared extractors.
// Works in dev (ts-node-dev), local build (node dist), and Docker.
// Do not change public function signatures.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type PayslipExtractionResult = {
  payDate: string | null;
  period?: { start?: string | null; end?: string | null; month?: string | null } | null;
  employer?: string | null;
  employeeName?: string | null;
  gross?: number | null;
  net?: number | null;
  tax?: number | null;
  ni?: number | null;
  pension?: number | null;
  pensionEmployee?: number | null;
  pensionEmployer?: number | null;
  studentLoan?: number | null;
  payFrequency?: string | null;
  taxCode?: string | null;
  niLetter?: string | null;
  ytd?: Record<string, unknown> | null;
  provenance?: Record<string, unknown> | null;
};

type StatementExtractionResult = {
  bankName?: string | null;
  accountNumberMasked?: string | null;
  accountType?: string | null;
  accountHolder?: string | null;
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
  }> | null;
  provenance?: Record<string, unknown> | null;
};

function resolveSharedModule(relativePath: string): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(moduleDir, '../../shared', relativePath),
    path.resolve(moduleDir, '../../../shared', relativePath),
    path.resolve(moduleDir, '../../../../shared', relativePath),
    path.resolve(moduleDir, '../../../../../shared', relativePath),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return pathToFileURL(candidate).href;
    }
  }
  throw new Error(`Unable to resolve shared module: ${relativePath}`);
}

const PAYSLIP_MODULE_URL = resolveSharedModule('extraction/payslip.js');
const STATEMENT_MODULE_URL = resolveSharedModule('extraction/statement.js');

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

export async function extractStatement(
  buffer: Buffer,
  meta?: { originalName?: string; schematicTransactions?: Array<{ date?: string; description?: string; amount?: number }> }
): Promise<StatementExtractionResult> {
  const mod = (await loadStatementModule()) as {
    extractStatement(
      buffer: Buffer,
      meta?: { originalName?: string; schematicTransactions?: Array<{ date?: string; description?: string; amount?: number }> }
    ): Promise<StatementExtractionResult>;
  };
  return mod.extractStatement(buffer, meta);
}
