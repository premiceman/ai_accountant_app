export interface PayslipPeriod {
  start?: string | null;
  end?: string | null;
  month?: string | null;
}

export interface PayslipExtractionResult {
  payDate: string;
  period?: PayslipPeriod;
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
export function analysePayslip(text: string): Promise<any>;
