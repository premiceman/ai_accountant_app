import Redis from 'ioredis';
import type { Types } from 'mongoose';
import pino from 'pino';
import { DocumentInsightModel } from '../models/index.js';
import { rebuildMonthlyAnalytics } from './analytics.js';

const logger = pino({ name: 'parse-result-bridge', level: process.env.LOG_LEVEL ?? 'info' });

let subscriber: InstanceType<typeof Redis> | null = null;
let running = false;
const inflight = new Set<string>();

function scheduleRelease(key: string, ms: number) {
  setTimeout(() => {
    inflight.delete(key);
  }, ms).unref?.();
}

async function handleParseCallback(docId: string): Promise<void> {
  if (!docId) return;
  if (inflight.has(docId)) {
    logger.debug({ docId }, 'Skipping duplicate parse callback');
    return;
  }
  inflight.add(docId);
  scheduleRelease(docId, 30_000);

  try {
    const insight = await DocumentInsightModel.findOne({ fileId: docId })
      .sort({ updatedAt: -1 })
      .lean()
      .exec();
    if (!insight) {
      logger.warn({ docId }, 'Parse callback received without matching DocumentInsight');
      return;
    }
    const userId = insight.userId as Types.ObjectId;
    const metadata = (insight.metadata ?? {}) as Record<string, unknown>;
    const payDate =
      insight.documentDate instanceof Date && !Number.isNaN(insight.documentDate.getTime())
        ? insight.documentDate.toISOString()
        : typeof metadata.payDate === 'string'
        ? (metadata.payDate as string)
        : null;
    const periodMeta = (metadata.period ?? {}) as Record<string, unknown>;
    const periodMonth =
      typeof insight.documentMonth === 'string' && insight.documentMonth
        ? insight.documentMonth
        : typeof periodMeta.month === 'string'
        ? (periodMeta.month as string)
        : null;
    const periodYear =
      typeof periodMeta.year === 'number'
        ? periodMeta.year
        : typeof periodMeta.year === 'string'
        ? (periodMeta.year as string)
        : null;

    const result = await rebuildMonthlyAnalytics({
      userId,
      periodMonth,
      periodYear,
      payDate,
      fileId: insight.fileId,
    });

    if (result.status === 'failed') {
      logger.warn(
        {
          docId,
          userId: userId.toHexString(),
          reason: result.reason,
        },
        'Parse bridge analytics rebuild failed'
      );
    } else {
      logger.info(
        {
          docId,
          userId: userId.toHexString(),
          period: result.period,
        },
        'Parse bridge analytics rebuild succeeded'
      );
    }
  } catch (error) {
    logger.error({ docId, err: error }, 'Parse bridge failed to rebuild analytics');
  }
}

export async function startParseResultBridge(): Promise<void> {
  if (running) return;
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  subscriber = new Redis(redisUrl, { lazyConnect: false });
  running = true;

  subscriber.on('message', (channel: string, message: string) => {
    if (channel !== 'parse:done') return;
    const docId = String(message || '').trim();
    if (!docId) return;
    void handleParseCallback(docId);
  });

  subscriber.on('error', (error: unknown) => {
    logger.error({ err: error }, 'Parse bridge Redis error');
  });

  await (subscriber as any).subscribe('parse:done');
  logger.info({ redisUrl }, 'Subscribed to parse:done notifications');
}

export async function stopParseResultBridge(): Promise<void> {
  if (!subscriber) return;
  try {
    await (subscriber as any).unsubscribe('parse:done');
  } catch (error) {
    logger.warn({ err: error }, 'Failed to unsubscribe parse bridge');
  }
  try {
    await subscriber.quit();
  } catch (error) {
    logger.warn({ err: error }, 'Failed to close parse bridge Redis connection cleanly');
  }
  subscriber = null;
  running = false;
  inflight.clear();
}
