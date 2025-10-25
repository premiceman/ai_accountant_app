export function format(date: Date | number | string, pattern: string): string;
export function parse(value: string, pattern: string, referenceDate?: Date): Date;
export function parseISO(value: string): Date;
export function isValid(date: unknown): boolean;
