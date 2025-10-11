export type DateParsePreference = 'DMY' | 'MDY';

export function getDateParsePreference(): DateParsePreference;
export interface DateParsingOptions {
  preference?: DateParsePreference;
  monthYearFallbackDay?: string | number | null;
  returnMetadata?: boolean;
}

export interface MonthYearMetadata {
  month: string;
  year: string;
  day?: string;
  inferredDay?: string;
  inference?: 'fallback';
  missingDay?: boolean;
  invalidFallbackDay?: boolean;
}

export interface DateParsingMetadata {
  preference: DateParsePreference;
  format?: 'iso' | 'numeric' | 'textual';
  source?: 'textual';
  monthYear?: MonthYearMetadata;
  invalid?: boolean;
  reason?: string;
}

export interface DateParsingResultWithMetadata {
  iso: string | null;
  metadata: DateParsingMetadata;
}

export const DEFAULT_MONTH_YEAR_FALLBACK_DAY: string;

export function parseDateString(
  value: unknown,
  preference: DateParsePreference | undefined,
  options: DateParsingOptions & { returnMetadata: true }
): DateParsingResultWithMetadata;
export function parseDateString(
  value: unknown,
  options: DateParsingOptions & { returnMetadata: true }
): DateParsingResultWithMetadata;
export function parseDateString(
  value: unknown,
  preferenceOrOptions?: DateParsePreference | DateParsingOptions,
  options?: DateParsingOptions
): string | null;
