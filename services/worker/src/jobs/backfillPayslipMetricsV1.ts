/* eslint-disable no-console */
import { MongoClient } from 'mongodb';

import {
  buildPayslipMetricsV1,
  type DocumentInsightLike,
  type PayslipMetricsV1 as MetricsV1,
} from '../../../../shared/lib/insights/normalizeV1.js';

const MONGO_URI = process.env.MONGO_URI ?? 'mongodb://localhost:27017';
const MONGO_DB = process.env.MONGO_DB_NAME ?? 'app';

async function run(): Promise<void> {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(MONGO_DB);
  const collection = db.collection<DocumentInsightLike & { _id: unknown; metricsV1?: MetricsV1 | null }>('documentinsights');

  const cursor = collection.find(
    {
      $and: [
        { $or: [{ insightType: 'payslip' }, { catalogueKey: 'payslip' }] },
        { $or: [{ metricsV1: { $exists: false } }, { 'metricsV1.grossMinor': { $in: [null, 0] } }] },
      ],
    },
    { noCursorTimeout: true }
  );

  let updated = 0;
  let failed = 0;

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    if (!doc) break;
    try {
      const fallbackType =
        typeof doc.insightType === 'string'
          ? doc.insightType
          : ('catalogueKey' in doc && typeof (doc as Record<string, unknown>).catalogueKey === 'string'
              ? ((doc as Record<string, unknown>).catalogueKey as string)
              : 'payslip');
      const metricsV1 = buildPayslipMetricsV1({ ...doc, insightType: fallbackType });
      await collection.updateOne({ _id: doc._id }, { $set: { metricsV1 } });
      updated += 1;
    } catch (error) {
      failed += 1;
      console.warn('Backfill failed for payslip insight', doc._id, error);
    }
  }

  await cursor.close();
  await client.close();

  console.log(`Backfill complete. Updated: ${updated}, Failed: ${failed}`);
}

run().catch((error) => {
  console.error('Backfill job failed', error);
  process.exitCode = 1;
});
