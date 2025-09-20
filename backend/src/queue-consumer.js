// backend/src/queue-consumer.js
const { pull, ack } = require('./utils/queues');
const { fetch } = require('undici');

const INTERNAL_BASE_URL = process.env.INTERNAL_BASE_URL || process.env.PUBLIC_BASE_URL || process.env.BASE_URL || 'https://www.phloat.io';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'superlongrandomsecret';

async function callInternal(path, body) {
  const url = new URL(path, INTERNAL_BASE_URL).toString();
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-key': INTERNAL_API_KEY
    },
    body: JSON.stringify(body || {})
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`internal call failed ${r.status}: ${t}`);
  }
  return r.json().catch(()=> ({}));
}

async function runQueueOnce() {
  try {
    const res = await pull(5, 60000);
    const msgs = res.messages || [];
    for (const m of msgs) {
      try {
        const body = m.body || {};
        const kind = body.event || body.type || 'validate';
        if (kind === 'validate') await callInternal('/api/internal/validate', body);
        else if (kind === 'extract') await callInternal('/api/internal/extract', body);
        else if (kind === 'analytics') await callInternal('/api/internal/analytics', body);
        await ack(m.id);
      } catch (e) {
        console.error('queue msg failed', e);
        // don't ack on failure so the message can be retried
      }
    }
  } catch (e) {
    console.error('queue poll error', e);
  }
}

function startQueuePolling() {
  runQueueOnce();
  setInterval(runQueueOnce, 10000);
}

module.exports = { startQueuePolling };
