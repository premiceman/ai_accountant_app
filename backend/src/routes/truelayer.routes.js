// backend/src/routes/truelayer.routes.js
const express = require("express");
const { fetch } = require("undici");
const auth = require("../../middleware/auth");
const User = require("../../models/User");
const Transaction = require("../../models/Transaction");
const crypto = require("crypto");

const router = express.Router();

const TL_AUTH_BASE = "https://auth.truelayer.com";
const TL_DATA_BASE = process.env.TL_USE_SANDBOX === "true"
  ? "https://api.truelayer-sandbox.com"
  : "https://api.truelayer.com";

// Start OAuth (link)
router.get("/connect", auth, async (req, res) => {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.TL_CLIENT_ID,
    redirect_uri: process.env.TL_REDIRECT_URI,
    scope: "info accounts balance transactions",
    nonce: crypto.randomBytes(16).toString("hex"),
    state: crypto.randomBytes(16).toString("hex"),
    enable_mock: (process.env.TL_USE_SANDBOX === "true" ? "true" : "false")
  });
  res.redirect(`${TL_AUTH_BASE}/?${params.toString()}`);
});

// OAuth callback
router.get("/callback", async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send("Missing code");

    const tokenRes = await fetch(`${TL_AUTH_BASE}/connect/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: process.env.TL_CLIENT_ID,
        client_secret: process.env.TL_CLIENT_SECRET,
        redirect_uri: process.env.TL_REDIRECT_URI,
        code
      })
    });
    const tokenJson = await tokenRes.json();

    // Store on user in production; quick start message for now
    return res.send("TrueLayer connected. You can now call /api/truelayer/ingest with your access_token (temp dev flow).");
  } catch (e) {
    console.error("TL callback error", e);
    res.status(500).send("Callback failed");
  }
});

// Ingest transactions (expects user auth)
router.post("/ingest", auth, async (req, res) => {
  try {
    const access_token = req.body?.access_token || req.headers["x-tl-access-token"];
    if (!access_token) return res.status(400).json({ error: "Missing access_token (temp dev flow)" });

    const accRes = await fetch(`${TL_DATA_BASE}/data/v1/accounts`, {
      headers: { authorization: `Bearer ${access_token}` }
    });
    const acc = await accRes.json();
    const accounts = acc.results || acc.accounts || [];

    let imported = 0;
    for (const a of accounts) {
      const txRes = await fetch(`${TL_DATA_BASE}/data/v1/accounts/${a.account_id}/transactions`, {
        headers: { authorization: `Bearer ${access_token}` }
      });
      const txJson = await txRes.json();
      const txs = txJson.results || txJson.transactions || [];
      for (const t of txs) {
        const date = new Date(t.timestamp || t.transaction_date);
        await Transaction.updateOne(
          { userId: req.user._id, date, amount: Number(t.amount), description: t.description || t.merchant_name, source: "truelayer" },
          {
            $setOnInsert: {
              userId: req.user._id,
              date,
              amount: Number(t.amount),
              currency: t.currency || "GBP",
              description: t.description || t.merchant_name,
              counterparty: t.merchant_name || (t.counterparty && t.counterparty.name),
              category: (t.transaction_classification && t.transaction_classification[0]) || "Uncategorised",
              source: "truelayer"
            }
          },
          { upsert: true }
        );
        imported++;
      }
    }

    res.json({ imported });
  } catch (e) {
    console.error("TL ingest error", e);
    res.status(500).json({ error: "ingest failed" });
  }
});

module.exports = router;
