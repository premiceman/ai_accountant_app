import { PayslipMetrics } from '../types';
import parseMoney from './money';
import { normaliseDates } from './date';
import { OverrideValue } from '../overrides';

const deductionKeywords = ['tax', 'ni', 'insurance', 'deduction', 'student loan'];

function assignNested(metrics: any, fieldKey: string, value: unknown) {
  const parts = fieldKey.split('.');
  let cursor = metrics;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (!cursor[key]) cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[parts[parts.length - 1]] = value;
}

function collectLineValues(line: string): number[] {
  const matches = Array.from(line.matchAll(/[-£$€()0-9.,]+/g)).map((m) => m[0]);
  return matches
    .map((token) => parseMoney(token))
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
}

function normaliseLabel(line: string): string {
  return line.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function extractPayslipMetrics(text: string, overrides: Map<string, OverrideValue>): PayslipMetrics {
  const metrics: PayslipMetrics = {
    period: {},
  } as PayslipMetrics;

  const dates = normaliseDates(text);
  metrics.period = {
    payDate: dates.payDateMMYYYY,
    periodStart: dates.periodStartMMYYYY,
    periodEnd: dates.periodEndMMYYYY,
  };

  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const earnings: Record<string, number> = {};
  const deductions: Record<string, number> = {};
  const ytdEarnings: Record<string, number> = {};
  const ytdDeductions: Record<string, number> = {};
  const totals: Record<string, number> = {};
  const totalsYtd: Record<string, number> = {};

  let inYtd = false;
  for (const line of lines) {
    const label = normaliseLabel(line);
    if (/year\s*to\s*date|ytd/.test(label)) {
      inYtd = true;
    }
    if (/this\s*period|current\s*period/.test(label)) {
      inYtd = false;
    }

    if (/employer/.test(label) && !metrics.employer?.name) {
      metrics.employer = { name: line.replace(/employer[:\s]*/i, '').trim() };
    }

    if (/net pay/.test(label)) {
      const values = collectLineValues(line);
      if (values.length) {
        totals.net = values[0];
        if (values.length > 1) totalsYtd.net = values[values.length - 1];
      }
      continue;
    }

    if (/gross/.test(label) && !/year/.test(label)) {
      const values = collectLineValues(line);
      if (values.length) {
        totals.gross = values[0];
        if (values.length > 1) totalsYtd.gross = values[values.length - 1];
      }
      continue;
    }

    const values = collectLineValues(line);
    if (!values.length) continue;

    const tokens = label.split(' ');
    if (!tokens.length) continue;
    const field = tokens.slice(0, Math.max(1, tokens.length - values.length)).join('_') || 'line';

    const isDeduction = deductionKeywords.some((keyword) => label.includes(keyword));
    if (values.length >= 2) {
      const current = values[0];
      const ytd = values[values.length - 1];
      if (isDeduction) {
        deductions[field] = current;
        ytdDeductions[field] = ytd;
      } else {
        earnings[field] = current;
        ytdEarnings[field] = ytd;
      }
      continue;
    }

    const current = values[0];
    if (isDeduction) {
      deductions[field] = current;
    } else {
      earnings[field] = current;
    }
    if (inYtd) {
      if (isDeduction) ytdDeductions[field] = current;
      else ytdEarnings[field] = current;
    }
  }

  if (Object.keys(totals).length) metrics.totals = totals;
  if (Object.keys(totalsYtd).length) {
    metrics.yearToDate = metrics.yearToDate || {};
    metrics.yearToDate.totals = totalsYtd;
  }
  if (Object.keys(earnings).length) metrics.earnings = earnings;
  if (Object.keys(deductions).length) metrics.deductions = deductions;
  if (Object.keys(ytdEarnings).length || Object.keys(ytdDeductions).length) {
    metrics.yearToDate = metrics.yearToDate || {};
    if (Object.keys(ytdEarnings).length) metrics.yearToDate.earnings = ytdEarnings;
    if (Object.keys(ytdDeductions).length) metrics.yearToDate.deductions = ytdDeductions;
  }

  overrides.forEach((entry, fieldKey) => {
    if (entry.value === undefined) return;
    assignNested(metrics, fieldKey, entry.value);
  });

  return metrics;
}
