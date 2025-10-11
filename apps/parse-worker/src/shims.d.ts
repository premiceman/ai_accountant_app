declare module 'pdf-parse';
declare module 'mammoth';
declare module '@fast-csv/parse';

declare module 'chrono-node' {
  export interface ChronoComponents {
    date(): Date | null;
  }

  export interface ChronoResult {
    text: string;
    start?: ChronoComponents;
  }

  export function parse(text: string, refDate?: Date, options?: Record<string, unknown>): ChronoResult[];
  export function parseDate(text: string, refDate?: Date, options?: Record<string, unknown>): Date | null;
}

declare module 'zod' {
  type ZodTypeAny = unknown;

  interface RefinementCtx {
    addIssue(issue: { code: string; message?: string }): void;
  }

  interface ZodType<T> {
    parse(data: unknown): T;
    safeParse(data: unknown): { success: true; data: T } | { success: false; error: { issues: Array<{ message: string }> } };
    optional(): ZodType<T | undefined>;
    min(value: number): ZodType<T>;
    int(): ZodType<T>;
    enum(values: readonly string[]): ZodType<T>;
    literal(value: unknown): ZodType<T>;
    extend(shape: Record<string, ZodTypeAny>): ZodType<T>;
  }

  interface ZodObject<T> extends ZodType<T> {
    extend(shape: Record<string, ZodTypeAny>): ZodObject<T>;
  }

  interface ZodRecord<T> extends ZodType<Record<string, T>> {}

  export const z: {
    object<T extends Record<string, ZodTypeAny>>(shape: T): ZodObject<{ [K in keyof T]: unknown }>;
    string(): ZodType<string>;
    number(): ZodType<number>;
    literal<T>(value: T): ZodType<T>;
    enum<T extends [string, ...string[]]>(values: T): ZodType<T[number]>;
    record<T>(value: ZodType<T>): ZodRecord<T>;
    discriminatedUnion<K extends string, U extends ZodTypeAny[]>(
      key: K,
      options: U
    ): ZodType<unknown>;
  };
}

declare module 'fast-xml-parser' {
  export interface X2jOptions {
    ignoreAttributes?: boolean;
    attributeNamePrefix?: string;
    ignoreDeclaration?: boolean;
  }

  export class XMLParser {
    constructor(options?: X2jOptions);
    parse(xmlData: string): unknown;
  }
}
