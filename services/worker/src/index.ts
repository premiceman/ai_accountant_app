// NOTE: Triage diagnostics for empty transactions (non-destructive). Remove after issue is resolved.
import express from 'express';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import pino from 'pino';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { URL, fileURLToPath } from 'node:url';
import { createHealthRouter } from './http/health.js';
import { startDocumentJobLoop, stopDocumentJobLoop } from './documentJobLoop.js';
import { featureFlags } from './config/featureFlags.js';
import { startDocupipePipeline, stopDocupipePipeline } from './services/docupipePipeline.js';

type DocupipeConfigModule = {
  DEFAULT_DOCUPIPE_BASE_URL: string;
  resolveDocupipeBaseUrl(
    env?: Partial<Record<string, string | undefined>> | NodeJS.ProcessEnv
  ): string;
  assertDocupipeBaseUrl(url: string, source?: string | undefined): string;
};

const require = createRequire(import.meta.url);
const docupipeConfigPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'shared',
  'config',
  'docupipe.js'
);
const { resolveDocupipeBaseUrl } = require(docupipeConfigPath) as DocupipeConfigModule;

dotenv.config();

const logger = pino({ name: 'worker', level: process.env.LOG_LEVEL ?? 'info' });

async function bootstrap() {
  const port = Number(process.env.WORKER_PORT ?? 8081);
  const app = express();
  const docupipeBaseUrl = resolveDocupipeBaseUrl(process.env);

  app.use(express.json());
  app.use(
    createHealthRouter({
      readinessCheck: async () => mongoose.connection.readyState === 1,
    })
  );

  const server = createServer(app);

  server.listen(port, async () => {
    logger.info({ port, docupipeBaseUrl }, 'Worker HTTP server listening');
  });

  try {
    const mongoUri = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/ai_accountant_app';
    if (featureFlags.enableTriageLogs) {
      try {
        const safeUriForParsing = mongoUri.replace(/^mongodb\+srv:\/\//i, 'mongodb://');
        const parsed = new URL(safeUriForParsing);
        const mongoHost = parsed.host || 'unknown';
        const rawPath = parsed.pathname || '';
        const mongoDb = rawPath.replace(/^\//, '').split('?')[0] || 'admin';
        logger.info(
          { area: 'statement-triage', phase: 'boot', mongoHost, mongoDb },
          'statement triage'
        );
      } catch (error) {
        logger.warn(
          {
            area: 'statement-triage',
            phase: 'boot',
            parsingError: (error as Error).message ?? 'unknown',
          },
          'statement triage'
        );
      }
    }
    await mongoose.connect(mongoUri);
    logger.info({ mongoUri }, 'Connected to MongoDB');
    await startDocumentJobLoop();
    await startDocupipePipeline();
    logger.info('Worker online');
  } catch (error) {
    logger.error({ err: error }, 'Failed to start worker loop');
    process.exit(1);
  }

  const shutdown = async (signal: NodeJS.Signals) => {
    logger.info({ signal }, 'Shutting down worker');
    server.close();
    await stopDocumentJobLoop();
    await stopDocupipePipeline();
    await mongoose.disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

void bootstrap();
