const PAD_TWO = (value) => String(value).padStart(2, '0');

export function isValid(date) {
  return date instanceof Date && !Number.isNaN(date.getTime());
}

export function format(date, pattern) {
  const instance = date instanceof Date ? date : new Date(date);
  if (!isValid(instance)) {
    throw new RangeError('Invalid time value');
  }
  const year = instance.getUTCFullYear();
  const month = PAD_TWO(instance.getUTCMonth() + 1);
  const day = PAD_TWO(instance.getUTCDate());
  if (pattern === 'yyyy-MM-dd') {
    return `${year}-${month}-${day}`;
  }
  if (pattern === 'yyyy-MM') {
    return `${year}-${month}`;
  }
  throw new Error(`Unsupported format pattern: ${pattern}`);
}

export function parse(value, pattern) {
  if (value == null) return new Date(NaN);
  const raw = String(value).trim();
  if (!raw) return new Date(NaN);

  if (pattern === 'dd/MM/yyyy' || pattern === 'd/M/yyyy') {
    const parts = raw.split(/[\/-]/);
    if (parts.length !== 3) return new Date(NaN);
    const [dayRaw, monthRaw, yearRaw] = parts;
    const day = Number(dayRaw);
    const month = Number(monthRaw);
    const year = Number(yearRaw);
    if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) {
      return new Date(NaN);
    }
    const result = new Date(Date.UTC(year, month - 1, day));
    return isValid(result) ? result : new Date(NaN);
  }

  if (pattern === 'MM/yyyy') {
    const parts = raw.split(/[\/-]/);
    if (parts.length !== 2) return new Date(NaN);
    const [monthRaw, yearRaw] = parts;
    const month = Number(monthRaw);
    const year = Number(yearRaw);
    if (!Number.isInteger(month) || !Number.isInteger(year)) {
      return new Date(NaN);
    }
    const result = new Date(Date.UTC(year, month - 1, 1));
    return isValid(result) ? result : new Date(NaN);
  }

  return new Date(NaN);
}

export function parseISO(value) {
  if (value instanceof Date) {
    return new Date(value);
  }
  if (typeof value !== 'string') {
    return new Date(NaN);
  }
  const result = new Date(value);
  return isValid(result) ? result : new Date(NaN);
}
