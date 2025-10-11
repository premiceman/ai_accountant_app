export function normaliseWhitespace(value: string): string {
  return value.replace(/\r/g, '\n').replace(/\u00a0/g, ' ').replace(/[\t ]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
}

export function chunkLines(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function parseNumberStrict(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[$£€]/g, '').replace(/\(/g, '-').replace(/\)/g, '').replace(/,/g, '').trim();
  if (!cleaned) return null;
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function dedupe<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatMonthYear(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear());
  return `${month}/${year}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
