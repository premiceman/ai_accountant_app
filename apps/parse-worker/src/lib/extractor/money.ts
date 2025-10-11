export function parseMoney(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const hasParens = /^\(.*\)$/.test(trimmed);
  const hasMinus = /^-/.test(trimmed);
  const hasCr = /\bCR\b/i.test(trimmed);
  const hasDr = /\bDR\b/i.test(trimmed);
  let sign = 1;
  if (hasParens || hasMinus || hasDr) sign = -1;
  if (hasCr) sign = 1;
  const cleaned = trimmed
    .replace(/[£$€]/g, '')
    .replace(/CR|DR/gi, '')
    .replace(/[()]/g, '')
    .replace(/,/g, '')
    .replace(/\s+/g, '');
  const value = Number.parseFloat(cleaned);
  if (Number.isNaN(value)) return null;
  return value * sign;
}

export function ensureNumber(value: unknown, dataType: 'number' | 'integer'): number {
  const parsed = parseMoney(value);
  if (parsed === null) {
    throw new Error('Value is not numeric');
  }
  if (dataType === 'integer') {
    return Math.trunc(parsed);
  }
  return parsed;
}

export default parseMoney;
