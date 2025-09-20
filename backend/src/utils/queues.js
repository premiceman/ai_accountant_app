// backend/src/utils/queues.js
const { fetch } = require("undici");

const API = `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/queues/${process.env.CF_QUEUE_ID}`;
const headers = {
  authorization: `Bearer ${process.env.CF_QUEUES_API_TOKEN}`,
  "content-type": "application/json",
};

async function enqueue(message) {
  const url = `${API}/messages`;
  const body = { body: message };
  const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Queues publish failed: ${r.status} ${await r.text()}`);
  return r.json();
}

async function pull({ batchSize = 10, visibilityMs = 15000 } = {}) {
  const url = `${API}/messages/pull`;
  const r = await fetch(url, {
    method: "POST", headers,
    body: JSON.stringify({ batch_size: batchSize, visibility_timeout_ms: visibilityMs })
  });
  if (!r.ok) throw new Error(`Queues pull failed: ${r.status} ${await r.text()}`);
  return r.json();
}

async function ack({ leaseIds = [], retryIds = [] }) {
  const url = `${API}/messages/ack`;
  const r = await fetch(url, {
    method: "POST", headers,
    body: JSON.stringify({
      acknowledges: leaseIds.map(id => ({ lease_id: id })),
      retries: retryIds.map(id => ({ lease_id: id }))
    })
  });
  if (!r.ok) throw new Error(`Queues ack failed: ${r.status} ${await r.text()}`);
  return r.json();
}

module.exports = { enqueue, pull, ack };
