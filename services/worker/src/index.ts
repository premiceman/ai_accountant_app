import express from 'express';
import dotenv from 'dotenv';
import pino from 'pino';
import { createServer } from 'node:http';
import { queueManager } from './queues/index.js';
import { createHealthRouter } from './http/health.js';

dotenv.config();

const logger = pino({ name: 'worker', level: process.env.LOG_LEVEL ?? 'info' });

async function bootstrap() {
  const port = Number(process.env.WORKER_PORT ?? 8081);
  const app = express();

  app.use(express.json());
  app.use(
    createHealthRouter({
      readinessCheck: async () => queueManager.isReady(),
    })
  );

  const server = createServer(app);

  server.listen(port, async () => {
    logger.info({ port }, 'Worker HTTP server listening');
  });

  try {
    await queueManager.start();
    logger.info('Worker online');
  } catch (error) {
    logger.error({ err: error }, 'Failed to start queues');
    process.exit(1);
  }

  const shutdown = async (signal: NodeJS.Signals) => {
    logger.info({ signal }, 'Shutting down worker');
    server.close();
    await queueManager.shutdown();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

void bootstrap();
