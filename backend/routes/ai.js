// backend/routes/ai.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

let OpenAI;
try {
  OpenAI = require('openai'); // npm i openai
} catch {
  // Fallback to REST if SDK not installed
  OpenAI = null;
}

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// Basic input guardrails
function validatePrompt(s) {
  return typeof s === 'string' && s.trim().length > 0 && s.length <= 4000;
}

// POST /api/ai/ask  { prompt: string }
router.post('/ask', auth, express.json(), async (req, res) => {
  try {
    const { prompt } = req.body || {};
    if (!validatePrompt(prompt)) {
      return res.status(400).json({ error: 'Invalid prompt' });
    }
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });

    // Prefer SDK if available
    if (OpenAI) {
      const client = new OpenAI({ apiKey });
      const completion = await client.chat.completions.create({
        model: MODEL,
        messages: [
          {
            role: 'system',
            content:
              'You are an AI Accountant assistant. Be concise, accurate, and helpful. If the user references documents, ask for context until document ingestion is enabled.',
          },
          { role: 'user', content: prompt.trim() },
        ],
        temperature: 0.2,
      });

      const msg = completion.choices?.[0]?.message?.content || '';
      return res.json({
        answer: msg,
        model: completion.model || MODEL,
        usage: completion.usage || null,
      });
    }

    // Minimal REST fallback (if SDK missing)
    const fetch = (await import('node-fetch')).default;
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: 'system',
            content:
              'You are an AI Accountant assistant. Be concise, accurate, and helpful. If the user references documents, ask for context until document ingestion is enabled.',
          },
          { role: 'user', content: prompt.trim() },
        ],
        temperature: 0.2,
      }),
    });
    if (!resp.ok) {
      const t = await resp.text();
      return res.status(502).json({ error: 'OpenAI error', details: t });
    }
    const data = await resp.json();
    const msg = data.choices?.[0]?.message?.content || '';
    return res.json({ answer: msg, model: data.model || MODEL, usage: data.usage || null });
  } catch (e) {
    console.error('POST /api/ai/ask error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
