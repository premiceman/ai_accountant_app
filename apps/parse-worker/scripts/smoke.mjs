import 'dotenv/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import mongoose from 'mongoose';
import { Types } from 'mongoose';
import DocumentInsight from '../../../backend/models/DocumentInsight.js';

const queueName = process.env.DOC_INSIGHTS_QUEUE || 'doc-insights';
const prefix = process.env.BULLMQ_PREFIX || 'ai_accountant';
const redisUrl = process.env.REDIS_URL;
const mongoUri = process.env.MONGODB_URI;
const userId = process.env.SMOKE_USER_ID || '000000000000000000000000';

if (!redisUrl || !mongoUri) {
  console.error('REDIS_URL and MONGODB_URI must be set for smoke test');
  process.exit(1);
}

const redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
const queue = new Queue(queueName, { connection: redis, prefix });

const sampleIds = (process.env.SMOKE_FILE_IDS || '108710A,794_Vyas,payslip_2024_11')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

async function run() {
  await mongoose.connect(mongoUri);
  console.log('Connected to Mongo');

  const jobs = await Promise.all(
    sampleIds.map((fileId) =>
      queue.add('parse', { userId, fileId, docType: 'payslip' }, { attempts: 1 })
    )
  );
  console.log(`Queued ${jobs.length} jobs`);

  const deadline = Date.now() + 60_000;
  const results = new Map();
  const userObjectId = new Types.ObjectId(userId);
  while (Date.now() < deadline && results.size < sampleIds.length) {
    // eslint-disable-next-line no-await-in-loop
    const docs = await DocumentInsight.find({ userId: userObjectId })
      .sort({ updatedAt: -1 })
      .lean()
      .exec();
    for (const doc of docs) {
      if (sampleIds.includes(doc.fileId)) {
        results.set(doc.fileId, doc);
      }
    }
    if (results.size === sampleIds.length) break;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  for (const fileId of sampleIds) {
    const doc = results.get(fileId);
    if (!doc) {
      console.warn(`No insights found for ${fileId}`);
      continue;
    }
    console.log(`\n=== ${fileId} ===`);
    console.log(JSON.stringify({ metrics: doc.metrics, metadata: doc.metadata }, null, 2));
  }

  await queue.close();
  redis.disconnect();
  await mongoose.connection.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
