import mongoose, { Connection, type ConnectOptions } from 'mongoose';
import pino from 'pino';

export type ProcessorFn<T = unknown> = (data: T) => Promise<void> | void;

export interface QueueDriver {
  start(): Promise<void>;
  registerProcessor<T>(queueName: string, processor: ProcessorFn<T>): void;
  enqueue<T>(queueName: string, data: T): Promise<void>;
  isReady(): boolean;
  shutdown(): Promise<void>;
}

const logger = pino({ name: 'worker-queues', level: process.env.LOG_LEVEL ?? 'info' });

interface OutboxDocument<T = unknown> {
  queue: string;
  payload: T;
  state: 'pending' | 'processing' | 'completed' | 'failed';
  attempts: number;
  availableAt: Date;
  createdAt: Date;
  lastError?: string;
}

const outboxSchema = new mongoose.Schema<OutboxDocument>(
  {
    queue: { type: String, index: true, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    state: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending', index: true },
    attempts: { type: Number, default: 0 },
    availableAt: { type: Date, default: () => new Date() },
    createdAt: { type: Date, default: () => new Date(), index: true },
    lastError: { type: String },
  },
  { collection: 'worker_outbox' }
);

interface TimerHandle {
  id: NodeJS.Timeout;
}

class MongoOutboxDriver implements QueueDriver {
  private readonly processors = new Map<string, ProcessorFn>();
  private readonly timers = new Map<string, TimerHandle>();
  private readonly activeQueues = new Set<string>();
  private connection?: Connection;
  private model?: mongoose.Model<OutboxDocument>;
  private ready = false;
  constructor(private readonly pollIntervalMs = 1000) {}

  private async ensureConnection(): Promise<void> {
    if (this.connection) {
      return;
    }

    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error('MONGODB_URI must be defined to use the Mongo outbox driver');
    }

    const options: ConnectOptions = {
      maxPoolSize: 4,
      minPoolSize: 1,
    };

    this.connection = await mongoose.createConnection(uri, options).asPromise();

    this.model = this.connection.model<OutboxDocument>('WorkerOutbox', outboxSchema);
  }

  private ensureTimer(queue: string) {
    if (this.timers.has(queue)) {
      return;
    }

    const timer: TimerHandle = {
      id: setInterval(() => {
        void this.drainQueue(queue);
      }, this.pollIntervalMs),
    };

    this.timers.set(queue, timer);
  }

  async start(): Promise<void> {
    try {
      await this.ensureConnection();
      this.ready = true;
      logger.info({ driver: 'mongo-outbox' }, 'Connected to Mongo-backed outbox');
      for (const queue of this.processors.keys()) {
        this.ensureTimer(queue);
      }
    } catch (error) {
      this.ready = false;
      logger.error({ err: error }, 'Failed to initialise Mongo outbox driver');
      throw error;
    }
  }

  registerProcessor<T>(queueName: string, processor: ProcessorFn<T>): void {
    this.processors.set(queueName, processor as ProcessorFn);
    if (this.ready) {
      this.ensureTimer(queueName);
    }
  }

  async enqueue<T>(queueName: string, data: T): Promise<void> {
    await this.ensureConnection();
    if (!this.model) {
      throw new Error('Outbox model not initialised');
    }

    await this.model.create({
      queue: queueName,
      payload: data,
      state: 'pending',
      attempts: 0,
      availableAt: new Date(),
      createdAt: new Date(),
    });
  }

  private async drainQueue(queueName: string) {
    if (!this.ready || !this.model) {
      return;
    }

    const processor = this.processors.get(queueName);
    if (!processor) {
      return;
    }

    if (this.activeQueues.has(queueName)) {
      return;
    }

    this.activeQueues.add(queueName);

    try {
      let doc = await this.model.findOneAndUpdate(
        {
          queue: queueName,
          state: 'pending',
          availableAt: { $lte: new Date() },
        },
        {
          $set: { state: 'processing' },
          $inc: { attempts: 1 },
        },
        { sort: { createdAt: 1 }, returnDocument: 'after' }
      );

      while (doc) {
        try {
          await processor(doc.payload);
          await this.model.updateOne({ _id: doc._id }, { $set: { state: 'completed', lastError: null } });
        } catch (error) {
          const delay = Math.min(60000, Math.pow(2, doc.attempts) * 1000);
          await this.model.updateOne(
            { _id: doc._id },
            {
              $set: {
                state: 'pending',
                availableAt: new Date(Date.now() + delay),
                lastError: (error as Error).message,
              },
            }
          );
          logger.error({ queue: queueName, err: error }, 'Outbox job failed');
        }

        doc = await this.model.findOneAndUpdate(
          {
            queue: queueName,
            state: 'pending',
            availableAt: { $lte: new Date() },
          },
          {
            $set: { state: 'processing' },
            $inc: { attempts: 1 },
          },
          { sort: { createdAt: 1 }, returnDocument: 'after' }
        );
      }
    } finally {
      this.activeQueues.delete(queueName);
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  async shutdown(): Promise<void> {
    for (const timer of this.timers.values()) {
      clearInterval(timer.id);
    }
    this.timers.clear();
    this.activeQueues.clear();
    this.ready = false;
    if (this.connection) {
      await this.connection.close();
      this.connection = undefined;
    }
  }
}

class InMemoryDriver implements QueueDriver {
  private readonly processors = new Map<string, ProcessorFn>();
  private ready = false;

  async start(): Promise<void> {
    this.ready = true;
    logger.warn('No MONGODB_URI found; using in-memory queue (non-persistent).');
  }

  registerProcessor<T>(queueName: string, processor: ProcessorFn<T>): void {
    this.processors.set(queueName, processor as ProcessorFn);
  }

  async enqueue<T>(queueName: string, data: T): Promise<void> {
    const processor = this.processors.get(queueName);
    if (!processor) {
      throw new Error(`No processor registered for queue ${queueName}`);
    }
    await processor(data);
  }

  isReady(): boolean {
    return this.ready;
  }

  async shutdown(): Promise<void> {
    this.ready = false;
    this.processors.clear();
  }
}

export class QueueManager {
  private driver: QueueDriver;

  constructor() {
    if (process.env.MONGODB_URI) {
      this.driver = new MongoOutboxDriver();
    } else {
      this.driver = new InMemoryDriver();
    }
  }

  registerProcessor<T>(queueName: string, processor: ProcessorFn<T>): void {
    this.driver.registerProcessor(queueName, processor);
  }

  async enqueue<T>(queueName: string, data: T): Promise<void> {
    await this.driver.enqueue(queueName, data);
  }

  async start(): Promise<void> {
    await this.driver.start();
  }

  async shutdown(): Promise<void> {
    await this.driver.shutdown();
  }

  isReady(): boolean {
    return this.driver.isReady();
  }
}

export const queueManager = new QueueManager();
