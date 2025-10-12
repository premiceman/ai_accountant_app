export type DateParsePreference = 'DMY' | 'MDY';

export function getDateParsePreference(): DateParsePreference;
export function parseDateString(value: unknown, preference?: DateParsePreference): string | null;
