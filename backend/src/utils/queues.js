// backend/src/utils/queues.js
const { fetch } = require('undici');

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_QUEUE_ID_OR_NAME = process.env.CF_QUEUE_ID;
const CF_QUEUES_API_TOKEN = process.env.CF_QUEUES_API_TOKEN;

const API_BASE = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/queues`;

async function resolveQueueId() {
  const id = (CF_QUEUE_ID_OR_NAME || '').trim();
  if (/^[a-f0-9]{32}$/i.test(id)) return id; // already ID

  // Resolve by name
  const r = await fetch(API_BASE, { headers: { Authorization: `Bearer ${CF_QUEUES_API_TOKEN}` } });
  const j = await r.json();
  if (!j.success) throw new Error('Failed to list queues');
  const q = (j.result || []).find(x =>
    x.queue_name === id || x.queue_id === id || x.id === id || x.name === id
  );
  if (!q) throw new Error(`Queue not found by name: ${id}`);
  return q.queue_id || q.id;
}

async function push(body) {
  const qid = await resolveQueueId();
  const r = await fetch(`${API_BASE}/${qid}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CF_QUEUES_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ body })
  });
  const j = await r.json();
  if (!j.success) throw new Error(`Queues push failed: ${r.status} ${JSON.stringify(j)}`);
  return j;
}

async function pull(batchSize = 5, vtMs = 120000) {
  const qid = await resolveQueueId();
  const r = await fetch(`${API_BASE}/${qid}/messages/pull`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CF_QUEUES_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ batch_size: batchSize, visibility_timeout_ms: vtMs })
  });
  const j = await r.json();
  if (!j.success) throw new Error(`Queues pull failed: ${r.status} ${JSON.stringify(j)}`);
  return j.result || { messages: [] };
}

async function ack(messageId) {
  const qid = await resolveQueueId();
  const r = await fetch(`${API_BASE}/${qid}/messages/ack`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CF_QUEUES_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ ack_ids: [messageId] })
  });
  const j = await r.json();
  if (!j.success) throw new Error(`Queues ack failed: ${r.status} ${JSON.stringify(j)}`);
  return j;
}

module.exports = { push, pull, ack };
