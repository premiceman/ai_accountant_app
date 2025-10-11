/**
 * ## Intent (Phase-1 only — additive, no breaking changes)
 *
 * Fix inconsistent dashboards by introducing a tiny, normalised v1 data layer alongside
 * today’s legacy fields. Worker dual-writes new normalised shapes, analytics prefers v1 with
 * legacy fallbacks, and Ajv validators warn without breaking existing flows.
 */

type ValidateFunction<T> = ((data: unknown) => boolean) & { errors: unknown };

export type PayslipMetricsV1 = {
  payDate: string;
  period: { start: string; end: string; month: string };
  employer: string | null;
  grossMinor: number;
  netMinor: number;
  taxMinor: number;
  nationalInsuranceMinor: number;
  pensionMinor: number;
  studentLoanMinor: number;
  taxCode?: string | null;
};

export type TransactionV1 = {
  id: string;
  date: string;
  description: string;
  amountMinor: number;
  direction: 'inflow' | 'outflow';
  category: string;
  accountId?: string | null;
  accountName?: string | null;
  currency: string;
};

export type StatementMetricsV1 = {
  period: { start: string; end: string; month: string };
  inflowsMinor: number;
  outflowsMinor: number;
  netMinor: number;
};

export type DashboardSummaryV1 = {
  period: { start: string; end: string; granularity: 'month' | 'quarter' | 'year' };
  totals: { incomeMinor: number; spendMinor: number; netMinor: number };
  version: 'v1';
};

export type AnalyticsCategoriesV1 = {
  period: { start: string; end: string };
  categories: Array<{ category: string; outflowMinor: number; inflowMinor?: number }>;
  version: 'v1';
};

export type AnalyticsLargestExpensesV1 = {
  period: { start: string; end: string };
  items: Array<{ date: string; description: string; amountMinor: number; category: string; accountId?: string | null }>;
  version: 'v1';
};

export type AnalyticsAccountsV1 = {
  period: { start: string; end: string };
  accounts: Array<{ accountId: string; name?: string | null; incomeMinor: number; spendMinor: number }>;
  version: 'v1';
};

export type AnalyticsTimeseriesV1 = {
  metric: 'income' | 'spend' | 'net';
  granularity: 'day' | 'week' | 'month';
  series: Array<{ ts: string; valueMinor: number }>;
  paydayEvents: Array<{ ts: string; amountMinor: number; employer?: string | null }>;
  version: 'v1';
};

export declare const canonicalCategories: readonly string[];
export declare const analyticsResponseSchemas: {
  dashboardSummaryV1: object;
  categoriesV1: object;
  largestExpensesV1: object;
  accountsV1: object;
  timeseriesV1: object;
};
export declare function normaliseCategory(raw: unknown): string;
export declare function ensureIsoDate(value: unknown): string | null;
export declare function ensureIsoMonth(value: unknown): string | null;
export declare function toMinorUnits(value: unknown): number;
export declare function toMajorUnits(value: unknown): number;
export declare function normaliseCurrency(value: unknown): string;
export declare const validatePayslipMetricsV1: ValidateFunction<PayslipMetricsV1>;
export declare const validateTransactionV1: ValidateFunction<TransactionV1>;
export declare const validateStatementMetricsV1: ValidateFunction<StatementMetricsV1>;
export declare const validateDashboardSummaryV1: ValidateFunction<DashboardSummaryV1>;
export declare const validateAnalyticsCategoriesV1: ValidateFunction<AnalyticsCategoriesV1>;
export declare const validateAnalyticsLargestExpensesV1: ValidateFunction<AnalyticsLargestExpensesV1>;
export declare const validateAnalyticsAccountsV1: ValidateFunction<AnalyticsAccountsV1>;
export declare const validateAnalyticsTimeseriesV1: ValidateFunction<AnalyticsTimeseriesV1>;
