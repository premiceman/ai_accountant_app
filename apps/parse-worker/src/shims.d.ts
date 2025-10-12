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

  interface ZodType<T> {
    parse(data: unknown): T;
    safeParse(data: unknown): { success: true; data: T } | { success: false; error: { issues: Array<{ message: string }> } };
    optional(): ZodType<T | undefined>;
    nullable(): ZodType<T | null>;
    default(value: T): ZodType<T>;
    min(value: number): ZodType<T>;
    max(value: number): ZodType<T>;
    int(): ZodType<T>;
    refine(predicate: (value: T) => boolean, message?: string): ZodType<T>;
  }

  interface ZodObject<T> extends ZodType<T> {
    extend(shape: Record<string, ZodTypeAny>): ZodObject<T>;
    optional(): ZodObject<T | undefined>;
  }

  interface ZodRecord<T> extends ZodType<Record<string, T>> {}

  interface ZodEnum<T extends readonly [string, ...string[]]> extends ZodType<T[number]> {
    default(value: T[number]): ZodEnum<T>;
  }

  interface ZodArray<T> extends ZodType<T[]> {
    min(value: number): ZodArray<T>;
  }

  export const z: {
    object<T extends Record<string, ZodTypeAny>>(shape: T): ZodObject<{ [K in keyof T]: unknown }>;
    string(): ZodType<string>;
    number(): ZodType<number>;
    literal<T>(value: T): ZodType<T>;
    enum<T extends readonly [string, ...string[]]>(values: T): ZodEnum<T>;
    array<T>(schema: ZodType<T>): ZodArray<T>;
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
