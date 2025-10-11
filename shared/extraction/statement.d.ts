export interface StatementPeriod {
  start: string;
  end: string;
  month?: string;
}

export interface StatementTransaction {
  date: string;
  description: string;
  amount: number;
  direction?: 'inflow' | 'outflow';
  category?: string | null;
}

export interface StatementExtractionResult {
  bankName?: string | null;
  accountNumberMasked?: string | null;
  accountType?: string | null;
  period: StatementPeriod;
  openingBalance?: number | null;
  closingBalance?: number | null;
  inflows?: number | null;
  outflows?: number | null;
  transactions: StatementTransaction[];
}

export function extractStatement(buffer: Buffer): Promise<StatementExtractionResult>;
export function analyseCurrentAccountStatement(text: string): Promise<any>;
