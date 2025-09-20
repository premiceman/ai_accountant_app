// backend/src/queue-consumer.js
const { pull, ack } = require("./utils/queues");
const { fetch } = require("undici");

const INTERNAL_URL = process.env.INTERNAL_BASE_URL || ""; // optional base if you use a custom internal host

async function callInternal(path, body) {
  const r = await fetch(`${INTERNAL_URL}/api/internal${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-key": process.env.INTERNAL_API_KEY
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`internal ${path} failed: ${r.status} ${await r.text()}`);
  return r.json();
}

async function runQueueOnce() {
  const p = await pull({ batchSize: 8, visibilityMs: 20000 });
  const msgs = p?.result?.messages || [];
  if (!msgs.length) return;

  const acks = [], retries = [];
  for (const m of msgs) {
    const leaseId = m.lease_id || m.id || m.metadata?.lease_id;
    try {
      const body = typeof m.body === "string" ? JSON.parse(m.body) : m.body;
      if (body?.event === "validate") {
        await callInternal("/validate", { docId: body.docId });
        await callInternal("/extract", { docId: body.docId });

        const now = new Date();
        const year = (now.getMonth() > 2 || (now.getMonth()===2 && now.getDate()>=6)) ? now.getFullYear() : now.getFullYear()-1;
        await callInternal("/materialize", { userId: body.userId, from: `${year}-04-06`, to: `${year+1}-04-05` });
      }
      acks.push(leaseId);
    } catch (e) {
      console.error("queue msg failed", e);
      retries.push(leaseId);
    }
  }

  if (acks.length || retries.length) await ack({ leaseIds: acks, retryIds: retries });
}

function startQueuePolling() {
  setInterval(() => {
    runQueueOnce().catch(e => console.error("queue poll error", e));
  }, 4000);
}

module.exports = { startQueuePolling };
