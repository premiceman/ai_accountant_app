import { createHash } from 'node:crypto';

const BULLET = '\u2022';

function normaliseDigits(value: unknown): string {
  return String(value ?? '')
    .replace(/[^0-9]/g, '')
    .trim();
}

export function maskAccount(value: unknown): string {
  const digits = normaliseDigits(value);
  if (!digits) return '';
  const last4 = digits.slice(-4);
  const maskedLength = Math.max(0, digits.length - last4.length);
  return `${BULLET.repeat(maskedLength)}${last4}`;
}

export function maskNI(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (raw.length <= 3) {
    return BULLET.repeat(raw.length);
  }
  const tail = raw.slice(-3);
  return `${BULLET.repeat(raw.length - 3)}${tail}`;
}

function getHashPepper(): string {
  const pepper = process.env.SEC_HASH_PEPPER;
  if (!pepper || !pepper.trim()) {
    throw new Error('SEC_HASH_PEPPER is required to hash PII');
  }
  return pepper.trim();
}

export function hashPII(value: unknown): string {
  const normalised = String(value ?? '').trim();
  if (!normalised) return '';
  return createHash('sha256').update(normalised + getHashPepper()).digest('hex');
}

export function accountLast4(value: unknown): string | null {
  const digits = normaliseDigits(value);
  if (!digits) return null;
  return digits.slice(-4) || null;
}

export function niLast3(value: unknown): string | null {
  const raw = String(value ?? '').replace(/\s+/g, '');
  if (!raw) return null;
  const tail = raw.slice(-3);
  return tail ? tail : null;
}
