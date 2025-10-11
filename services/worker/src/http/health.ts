import express, { Request, Response } from 'express';

export interface HealthRouterOptions {
  readinessCheck?: () => Promise<boolean> | boolean;
  healthInfoProvider?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
}

export function createHealthRouter(options: HealthRouterOptions = {}) {
  const { readinessCheck, healthInfoProvider } = options;
  const router = express.Router();

  router.get('/healthz', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  router.get('/readyz', async (_req: Request, res: Response) => {
    try {
      if (readinessCheck) {
        const ready = await readinessCheck();
        if (!ready) {
          return res.status(503).json({ status: 'not_ready' });
        }
      }
      return res.status(200).json({ status: 'ok' });
    } catch (error) {
      return res.status(503).json({ status: 'error', message: (error as Error).message });
    }
  });

  router.get('/health', async (_req: Request, res: Response) => {
    try {
      const payload = healthInfoProvider ? await healthInfoProvider() : { status: 'ok' };
      return res.status(200).json(payload);
    } catch (error) {
      return res.status(500).json({ status: 'error', message: (error as Error).message });
    }
  });

  return router;
}
