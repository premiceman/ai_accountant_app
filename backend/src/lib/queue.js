const { lpush } = require('./kv');

const ENABLE_SCHEMATICS = String(process.env.ENABLE_SCHEMATICS || 'true').toLowerCase() !== 'false';

let Queue;
let IORedis;
let queueInstance = null;
let redisMissingLogged = false;

function getQueue() {
  if (!ENABLE_SCHEMATICS) {
    if (!Queue) Queue = require('bullmq').Queue;
    if (!IORedis) IORedis = require('ioredis');
    if (queueInstance) return queueInstance;
    const url = process.env.REDIS_URL;
    if (!url) {
      if (!redisMissingLogged) {
        redisMissingLogged = true;
        console.warn('[queue] REDIS_URL missing; document parse jobs will be skipped');
      }
      return null;
    }
    const queueName = process.env.DOC_INSIGHTS_QUEUE || 'doc-insights';
    const prefix = process.env.BULLMQ_PREFIX || 'ai_accountant';
    const connection = new IORedis(url, { maxRetriesPerRequest: null });
    queueInstance = new Queue(queueName, { connection, prefix });
    return queueInstance;
  }
  return null;
}

async function enqueueDocumentParse(payload) {
  if (ENABLE_SCHEMATICS) {
    await lpush('parse:jobs', payload);
    return null;
  }
  const queue = getQueue();
  if (!queue) return null;
  const jobData = { ...payload };
  return queue.add(payload.docType || 'parse', jobData, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: true,
    removeOnFail: false,
  });
}

module.exports = {
  enqueueDocumentParse,
  __private__: { getQueue },
};
