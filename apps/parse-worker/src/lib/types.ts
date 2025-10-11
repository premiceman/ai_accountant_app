export type MoneyMap = Record<string, number>;

export type PayslipPeriod = {
  payDate?: string;
  periodStart?: string;
  periodEnd?: string;
};

export type PayslipMetrics = {
  period: PayslipPeriod;
  totals?: MoneyMap;
  earnings?: MoneyMap;
  deductions?: MoneyMap;
  employer?: { name?: string };
  yearToDate?: {
    totals?: MoneyMap;
    earnings?: MoneyMap;
    deductions?: MoneyMap;
  };
};

export type PayslipInsight = {
  baseKey: string;
  key: string;
  metrics: { payslip: PayslipMetrics } & Record<string, unknown>;
  metadata: Record<string, unknown>;
};

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

function assertMMYYYY(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new ValidationError(`${fieldName} must be a string in MM/YYYY format`);
  }
  if (!/^(0[1-9]|1[0-2])\/\d{4}$/.test(value)) {
    throw new ValidationError(`${fieldName} must match MM/YYYY`);
  }
  return value;
}

function assertNumber(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new ValidationError(`${fieldName} must be a valid number`);
  }
  return value;
}

function validateMoneyMap(value: unknown, fieldName: string): MoneyMap {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${fieldName} must be an object map of numbers`);
  }
  const entries = Object.entries(value as Record<string, unknown>);
  const result: MoneyMap = {};
  for (const [key, val] of entries) {
    result[key] = assertNumber(val, `${fieldName}.${key}`);
  }
  return result;
}

function validatePeriod(value: unknown): PayslipPeriod {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('period must be an object');
  }
  const period = value as Record<string, unknown>;
  const result: PayslipPeriod = {};
  if (period.payDate != null) {
    result.payDate = assertMMYYYY(period.payDate, 'period.payDate');
  }
  if (period.periodStart != null) {
    result.periodStart = assertMMYYYY(period.periodStart, 'period.periodStart');
  }
  if (period.periodEnd != null) {
    result.periodEnd = assertMMYYYY(period.periodEnd, 'period.periodEnd');
  }
  return result;
}

function validateEmployer(value: unknown): { name?: string } | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('employer must be an object');
  }
  const employer = value as Record<string, unknown>;
  if (employer.name != null && typeof employer.name !== 'string') {
    throw new ValidationError('employer.name must be a string');
  }
  return employer.name ? { name: employer.name } : {};
}

function validateYearToDate(value: unknown): PayslipMetrics['yearToDate'] {
  if (value == null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('yearToDate must be an object');
  }
  const section = value as Record<string, unknown>;
  const result: PayslipMetrics['yearToDate'] = {};
  if (section.totals != null) {
    result.totals = validateMoneyMap(section.totals, 'yearToDate.totals');
  }
  if (section.earnings != null) {
    result.earnings = validateMoneyMap(section.earnings, 'yearToDate.earnings');
  }
  if (section.deductions != null) {
    result.deductions = validateMoneyMap(section.deductions, 'yearToDate.deductions');
  }
  return result;
}

export function validatePayslipMetrics(value: unknown): PayslipMetrics {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('payslip metrics must be an object');
  }
  const payload = value as Record<string, unknown>;
  if (!payload.period) {
    throw new ValidationError('period is required');
  }
  const period = validatePeriod(payload.period);

  const result: PayslipMetrics = { period };
  if (payload.totals != null) {
    result.totals = validateMoneyMap(payload.totals, 'totals');
  }
  if (payload.earnings != null) {
    result.earnings = validateMoneyMap(payload.earnings, 'earnings');
  }
  if (payload.deductions != null) {
    result.deductions = validateMoneyMap(payload.deductions, 'deductions');
  }
  result.employer = validateEmployer(payload.employer);
  result.yearToDate = validateYearToDate(payload.yearToDate);
  return result;
}

export function validatePayslipInsight(value: unknown): PayslipInsight {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('insight payload must be an object');
  }
  const payload = value as Record<string, unknown>;
  if (typeof payload.baseKey !== 'string' || typeof payload.key !== 'string') {
    throw new ValidationError('baseKey and key must be strings');
  }
  const metrics = payload.metrics as Record<string, unknown>;
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) {
    throw new ValidationError('metrics must be an object');
  }
  const payslip = validatePayslipMetrics((metrics as Record<string, unknown>).payslip);
  const metadata = (payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {}) as Record<string, unknown>;

  return {
    baseKey: payload.baseKey,
    key: payload.key,
    metrics: { ...metrics, payslip },
    metadata,
  };
}

export { ValidationError };
