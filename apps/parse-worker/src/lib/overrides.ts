import mongoose from 'mongoose';
import { FieldOverride } from './models';
import { ensureNumber } from './extractor/money';
import { normaliseDates } from './extractor/date';

export type OverrideValue = {
  fieldKey: string;
  value?: unknown;
  error?: string;
  dataType: 'number' | 'integer' | 'string' | 'dateMMYYYY';
};

export async function loadOverrides(userId: string, docType: string) {
  if (!mongoose.Types.ObjectId.isValid(userId)) return [];
  return FieldOverride.find({ userId, docType, enabled: true }).lean();
}

function applyDataType(value: unknown, dataType: OverrideValue['dataType']): unknown {
  if (value == null) return value;
  switch (dataType) {
    case 'number':
    case 'integer':
      return ensureNumber(value, dataType);
    case 'dateMMYYYY': {
      const text = typeof value === 'string' ? value : String(value ?? '');
      const normalized = normaliseDates(text);
      const first = normalized.payDateMMYYYY || normalized.periodEndMMYYYY || normalized.periodStartMMYYYY;
      if (!first) {
        throw new Error('Unable to normalise override date');
      }
      return first;
    }
    default:
      return String(value);
  }
}

function findValueFromText(strategy: any, text: string): string | null {
  if (!strategy) return null;
  if (strategy.regex) {
    try {
      const regex = new RegExp(strategy.regex, 'i');
      const match = text.match(regex);
      if (match) {
        const groups = match.slice(1).filter(Boolean);
        return groups[0] || match[0];
      }
    } catch (error) {
      throw new Error(`Invalid override regex: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }
  if (strategy.anchorLabel) {
    const lines = text.split(/\n+/);
    const anchor = lines.find((line) => line.toLowerCase().includes(String(strategy.anchorLabel).toLowerCase()));
    if (anchor) {
      const candidate = anchor.split(/[:\s]+/).pop();
      if (candidate) return candidate;
    }
  }
  return null;
}

export function applyOverrides(
  overrides: any[],
  text: string
): { applied: Map<string, OverrideValue>; errors: OverrideValue[] } {
  const applied = new Map<string, OverrideValue>();
  const errors: OverrideValue[] = [];
  for (const override of overrides) {
    const { fieldKey, dataType, selectorStrategy } = override;
    let rawValue: unknown = findValueFromText(selectorStrategy, text);
    if (rawValue == null && override.sampleValue != null) rawValue = override.sampleValue;
    if (rawValue == null) {
      errors.push({ fieldKey, dataType, error: 'No value matched for override' });
      continue;
    }
    try {
      const value = applyDataType(rawValue, dataType);
      applied.set(fieldKey, { fieldKey, dataType, value });
    } catch (err) {
      errors.push({
        fieldKey,
        dataType,
        error: err instanceof Error ? err.message : 'Failed to coerce override value',
      });
    }
  }
  return { applied, errors };
}
