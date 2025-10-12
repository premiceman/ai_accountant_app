declare module '../../../../shared/extraction/payslip.js' {
  export interface PayslipExtractionResult {
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
  }

  export function extractPayslip(buffer: Buffer): Promise<PayslipExtractionResult>;
}

declare module '../../../../shared/extraction/statement.js' {
  export interface StatementExtractionResult {
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
    }> | null;
  }

  export function extractStatement(
    buffer: Buffer,
    meta?: { originalName?: string; schematicTransactions?: Array<{ date?: string; description?: string; amount?: number }> }
  ): Promise<StatementExtractionResult>;
}
