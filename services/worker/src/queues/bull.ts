import { Queue, Worker, JobsOptions, Job } from 'bullmq';
import Redis, { RedisOptions } from 'ioredis';

export type ProcessorFn<T = unknown> = (data: T) => Promise<void> | void;

export interface BullQueueDriverOptions {
  connection?: RedisOptions;
  defaultJobOptions?: JobsOptions;
}

export class BullQueueDriver {
  private queues = new Map<string, Queue>();
  private workers = new Map<string, Worker<any, void, string>>();
  private readonly options: BullQueueDriverOptions;
  private connection?: Redis;

  constructor(options: BullQueueDriverOptions = {}) {
    this.options = options;
  }

  async ping(): Promise<void> {
    const connection = this.getConnection();
    await connection.ping();
  }

  private getConnection(): Redis {
    if (!this.connection) {
      const redisUrl = process.env.REDIS_URL;
      if (!redisUrl) {
        throw new Error('REDIS_URL must be defined to use BullMQ driver');
      }
      this.connection = new Redis(redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        ...this.options.connection,
      });
    }

    return this.connection;
  }

  private getQueue(name: string): Queue {
    if (!this.queues.has(name)) {
      const queue = new Queue(name, {
        connection: this.getConnection(),
        defaultJobOptions: this.options.defaultJobOptions,
      });
      this.queues.set(name, queue);
    }

    return this.queues.get(name)!;
  }

  registerProcessor<T>(name: string, processor: ProcessorFn<T>) {
    if (this.workers.has(name)) {
      return;
    }

    const connection = this.getConnection();
    const worker = new Worker<T, void, string>(
      name,
      async (job: Job<T, void, string>) => {
        await processor(job.data);
      },
      { connection }
    );

    this.workers.set(name, worker as Worker<any, void, string>);
  }

  async enqueue<T>(name: string, data: T, options?: JobsOptions) {
    const queue = this.getQueue(name);
    await queue.add(name, data, options);
  }

  async close() {
    await Promise.all(
      Array.from(this.workers.values()).map(async (worker) => {
        await worker.close();
      })
    );
    this.workers.clear();

    await Promise.all(Array.from(this.queues.values()).map((queue) => queue.close()));
    this.queues.clear();

    if (this.connection) {
      await this.connection.quit();
      this.connection = undefined;
    }
  }
}
