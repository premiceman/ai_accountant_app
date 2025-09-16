// backend/routes/ai.js
require('dotenv').config();
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

let fetchFn = globalThis.fetch;
if (!fetchFn) {
  try { fetchFn = require('node-fetch'); } catch (e) {}
}
const fetch = fetchFn;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_CHAT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// Simple guard so devs get a clean error
function ensureKey() {
  if (!OPENAI_API_KEY) {
    const err = new Error('OpenAI API key is missing. Set OPENAI_API_KEY in your environment.');
    err.status = 500;
    throw err;
  }
}

// POST /api/ai/chat  (streams SSE)
router.post('/chat', auth, async (req, res) => {
  try {
    ensureKey();

    const body = req.body || {};
    // Accept either messages[] or a single prompt
    let messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length && body.prompt) {
      messages = [{ role: 'user', content: String(body.prompt) }];
    }

    // Hardening: clamp to last 24 messages max (no server memory)
    if (messages.length > 24) messages = messages.slice(-24);

    // Provide a lightweight system prompt to keep tone on-brand
    // (Does not affect any existing logic; only for this endpoint.)
    const sys = {
      role: 'system',
      content:
        "You are the AI Accountant Scenario Lab assistant. Be concise, helpful, and clear. " +
        "When giving numbers or steps, be explicit and ordered. Avoid storing any personal data."
    };
    const finalMessages =
      messages[0]?.role === 'system' ? messages : [sys, ...messages];

    // Prepare OpenAI request (streaming)
    const reqBody = {
      model: OPENAI_CHAT_MODEL,
      stream: true,
      messages: finalMessages
    };

    // Start SSE response to the browser
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    const upstream = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(reqBody)
    });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => '');
      res.write(`data: ${JSON.stringify({ error: text || `Upstream error ${upstream.status}` })}\n\n`);
      return res.end();
    }

    // Pipe OpenAI SSE -> our SSE with tiny transform {delta:"..."}
    const reader = upstream.body.getReader ? upstream.body.getReader() : null;
    if (reader) {
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Process event-stream lines
        let idx;
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx).trimEnd();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          if (!line.startsWith('data:')) continue;

          const payload = line.slice(5).trim();
          if (payload === '[DONE]') {
            res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
            res.end();
            return;
          }
          try {
            const json = JSON.parse(payload);
            const piece = json?.choices?.[0]?.delta?.content || '';
            if (piece) res.write(`data: ${JSON.stringify({ delta: piece })}\n\n`);
          } catch {
            // Non-JSON keepalives etc. – ignore
          }
        }
      }
    } else {
      // Fallback (no streaming support) – return a single chunk
      const text = await upstream.text();
      try {
        const json = JSON.parse(text);
        const full = json?.choices?.[0]?.message?.content || '';
        res.write(`data: ${JSON.stringify({ delta: full })}\n\n`);
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      } catch {
        res.write(`data: ${JSON.stringify({ error: 'Upstream parse error' })}\n\n`);
      }
      res.end();
    }
  } catch (e) {
    console.error('AI chat error:', e);
    const msg = e?.message || 'Server error';
    // Make sure we always end the stream
    try { res.write(`data: ${JSON.stringify({ error: msg })}\n\n`); } catch {}
    try { res.end(); } catch {}
  }
});

module.exports = router;
