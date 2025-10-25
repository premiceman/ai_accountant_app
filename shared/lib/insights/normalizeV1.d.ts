export type MoneyMinor = number;

export interface PayslipMetricsV1 {
  payDate: string;
  period: { start: string; end: string; month: string | null };
  employer: { name?: string | null } | null;
  grossMinor: MoneyMinor;
  netMinor: MoneyMinor;
  taxMinor: MoneyMinor;
  nationalInsuranceMinor: MoneyMinor;
  pensionMinor: MoneyMinor;
  studentLoanMinor: MoneyMinor;
  taxCode: string | null;
}

export interface StatementTxV1 {
  date: string;
  description: string;
  amountMinor: MoneyMinor;
  balanceMinor?: MoneyMinor | null;
}

export interface StatementMetricsV1 {
  account?: { name?: string | null; iban?: string | null; sortCode?: string | null; accountNumber?: string | null } | null;
  period: { start: string | null; end: string | null; month: string | null };
  openingBalanceMinor?: MoneyMinor | null;
  closingBalanceMinor?: MoneyMinor | null;
  inflowsMinor: MoneyMinor;
  outflowsMinor: MoneyMinor;
  netMinor: MoneyMinor;
  transactionsV1: StatementTxV1[];
}

export interface InsightNormalizationResult<T extends PayslipMetricsV1 | StatementMetricsV1 | null> {
  kind: string;
  metricsV1: T;
}

export type DocumentInsightLike = {
  _id?: unknown;
  insightType?: string | null;
  catalogueKey?: string | null;
  documentDate?: unknown;
  documentDateV1?: unknown;
  documentMonth?: string | null;
  metadata?: Record<string, any> | null;
  metrics?: Record<string, any> | null;
  metricsV1?: Record<string, any> | null;
  transactionsV1?: unknown[] | null;
};

export function buildPayslipMetricsV1(di: DocumentInsightLike): PayslipMetricsV1 | null;
export function buildStatementV1(di: DocumentInsightLike): StatementMetricsV1 | null;
export function normalizeInsightV1(
  di: DocumentInsightLike
): InsightNormalizationResult<PayslipMetricsV1 | StatementMetricsV1 | null> | null;
