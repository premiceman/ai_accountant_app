declare module 'ioredis' {
  export default class Redis {
    constructor(connectionString?: string, options?: Record<string, unknown>);
    on(event: string, handler: (...args: any[]) => void): this;
    quit(): Promise<'OK'>;
    llen(key: string): Promise<number>;
  }
}
