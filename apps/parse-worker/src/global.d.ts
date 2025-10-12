type SignalEvent = 'SIGINT' | 'SIGTERM';

interface NodeProcess {
  env: Record<string, string | undefined>;
  on(event: SignalEvent, listener: (...args: unknown[]) => void | Promise<void>): void;
  exit(code?: number): never;
}

declare const process: NodeProcess;

interface Buffer extends Uint8Array {
  toString(encoding?: string): string;
}

interface BufferConstructor {
  from(data: ArrayBuffer | ArrayLike<number> | string, encoding?: string): Buffer;
}

declare const Buffer: BufferConstructor;

declare module 'node:fs/promises' {
  export function readFile(path: string | URL): Promise<Buffer>;
}

declare module 'node:http' {
  interface IncomingMessage {
    url?: string | null;
  }

  interface ServerResponse {
    writeHead(statusCode: number, headers?: Record<string, string>): ServerResponse;
    end(data?: string): void;
  }

  type RequestListener = (req: IncomingMessage, res: ServerResponse) => void;

  class Server {
    listen(port: number, callback?: () => void): Server;
    close(callback?: () => void): void;
  }

  function createServer(listener: RequestListener): Server;

  export { createServer, IncomingMessage, Server, ServerResponse };
}

declare module 'ioredis' {
  interface RedisOptions {
    lazyConnect?: boolean;
  }

  type RedisSetOptions = Array<string | number>;

  export default class Redis {
    constructor(connectionString?: string, options?: RedisOptions);
    brpop(key: string, timeout: number): Promise<[string, string] | null>;
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ...args: RedisSetOptions): Promise<'OK' | null>;
    publish(channel: string, message: string): Promise<number>;
    lpush(key: string, value: string): Promise<number>;
    llen(key: string): Promise<number>;
    quit(): Promise<void>;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: 'ready', listener: () => void): this;
    on(event: 'end', listener: () => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
  }
}
