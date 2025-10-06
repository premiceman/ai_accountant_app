import express, { Request, Response } from 'express';

export interface HealthRouterOptions {
  readinessCheck?: () => Promise<boolean> | boolean;
}

export function createHealthRouter(options: HealthRouterOptions = {}) {
  const { readinessCheck } = options;
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

  return router;
}
