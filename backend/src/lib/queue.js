const { Queue } = require('bullmq');
const IORedis = require('ioredis');

const queueName = process.env.DOC_INSIGHTS_QUEUE || 'doc-insights';
const prefix = process.env.BULLMQ_PREFIX || 'ai_accountant';
let queueInstance = null;
let redisMissingLogged = false;

function getQueue() {
  if (queueInstance) return queueInstance;
  const url = process.env.REDIS_URL;
  if (!url) {
    if (!redisMissingLogged) {
      redisMissingLogged = true;
      console.warn('[queue] REDIS_URL missing; document parse jobs will be skipped');
    }
    return null;
  }
  const connection = new IORedis(url, { maxRetriesPerRequest: null });
  queueInstance = new Queue(queueName, { connection, prefix });
  return queueInstance;
}

async function enqueueDocumentParse(payload) {
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
