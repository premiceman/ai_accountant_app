// backend/src/utils/queues.js
const { fetch } = require("undici");

const ACCOUNT_ID = (process.env.CF_ACCOUNT_ID || '').trim();
const TOKEN = (process.env.CF_QUEUES_API_TOKEN || '').trim();
const RAW_ID_OR_NAME = (process.env.CF_QUEUE_ID || '').trim();

const API_ROOT = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}`;
const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

let _queueIdCache = null;
const looksLikeId = s => typeof s === "string" && /^[A-Za-z0-9]{32}$/.test(s);

async function resolveQueueId() {
  if (_queueIdCache) return _queueIdCache;
  if (!ACCOUNT_ID || !TOKEN || !RAW_ID_OR_NAME) {
    throw new Error("Queues config missing: CF_ACCOUNT_ID, CF_QUEUES_API_TOKEN, CF_QUEUE_ID");
  }

  // If it's already an ID, use it
  if (looksLikeId(RAW_ID_OR_NAME)) {
    _queueIdCache = RAW_ID_OR_NAME;
    return _queueIdCache;
  }

  // Otherwise treat as name → find ID
  const r = await fetch(`${API_ROOT}/queues`, { headers });
  if (!r.ok) throw new Error(`Queues list failed: ${r.status} ${await r.text()}`);
  const data = await r.json().catch(() => ({}));
  const list = data?.result || data?.results || [];
  const match = list.find(q => q?.name === RAW_ID_OR_NAME);
  if (!match || !looksLikeId(match.id)) {
    throw new Error(`Could not resolve queue "${RAW_ID_OR_NAME}". Set CF_QUEUE_ID to the 32-char ID.`);
  }
  _queueIdCache = match.id;
  return _queueIdCache;
}

async function base() {
  const id = await resolveQueueId();
  return `${API_ROOT}/queues/${id}`;
}

async function enqueue(message) {
  const url = `${await base()}/messages`;
  const r = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ body: message })
  });
  if (!r.ok) throw new Error(`Queues publish failed: ${r.status} ${await r.text()}`);
  return r.json();
}

async function pull({ batchSize = 10, visibilityMs = 15000 } = {}) {
  const url = `${await base()}/messages/pull`;
  const r = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ batch_size: batchSize, visibility_timeout_ms: visibilityMs })
  });
  if (!r.ok) throw new Error(`Queues pull failed: ${r.status} ${await r.text()}`);
  return r.json();
}

async function ack({ leaseIds = [], retryIds = [] }) {
  const url = `${await base()}/messages/ack`;
  const r = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      acknowledges: leaseIds.map(id => ({ lease_id: id })),
      retries: retryIds.map(id => ({ lease_id: id }))
    })
  });
  if (!r.ok) throw new Error(`Queues ack failed: ${r.status} ${await r.text()}`);
  return r.json();
}

module.exports = { enqueue, pull, ack };
