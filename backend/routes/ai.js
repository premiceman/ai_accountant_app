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

let pdfParse = null;
try {
  pdfParse = require('pdf-parse');
} catch (err) {
  console.warn('⚠️  pdf-parse not available; vault document summaries disabled.');
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_CHAT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const MAX_DOCS = 4;
const MAX_PDF_BYTES = 5 * 1024 * 1024; // 5MB per document
const MAX_DOC_CHARS = 1600;            // per document chunk limit
const MAX_TOTAL_DOC_CHARS = 9000;      // cumulative across docs

// Simple guard so devs get a clean error
function ensureKey() {
  if (!OPENAI_API_KEY) {
    const err = new Error('OpenAI API key is missing. Set OPENAI_API_KEY in your environment.');
    err.status = 500;
    throw err;
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function filenameFromDisposition(disposition) {
  if (!disposition) return null;
  const match = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
  if (match) {
    const filename = match[1] || match[2];
    try { return decodeURIComponent(filename); }
    catch { return filename; }
  }
  return null;
}

function normaliseText(str) {
  return String(str || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/\u0000/g, '')
    .replace(/ +/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function chunkForPrompt(text, perChunk, totalLimit) {
  const out = [];
  if (!text) return out;
  const paragraphs = text.split(/\n{2,}/);
  let current = '';
  const pushCurrent = () => {
    if (current) {
      out.push(current.trim());
      current = '';
    }
  };
  for (const para of paragraphs) {
    const cleaned = para.trim();
    if (!cleaned) continue;
    if ((current + '\n\n' + cleaned).trim().length <= perChunk) {
      current = current ? `${current}\n\n${cleaned}` : cleaned;
    } else {
      pushCurrent();
      if (cleaned.length <= perChunk) {
        current = cleaned;
      } else {
        for (let i = 0; i < cleaned.length; i += perChunk) {
          out.push(cleaned.slice(i, i + perChunk));
        }
      }
    }
  }
  pushCurrent();

  const trimmed = [];
  let used = 0;
  for (const chunk of out) {
    if (used >= totalLimit) break;
    const remaining = totalLimit - used;
    const piece = chunk.length > remaining ? chunk.slice(0, remaining) : chunk;
    if (piece) {
      trimmed.push(piece);
      used += piece.length;
    }
  }
  return trimmed;
}

async function buildVaultContext(req, vaultIds) {
  const statuses = [];
  if (!Array.isArray(vaultIds) || !vaultIds.length) {
    return { statuses, prompt: null };
  }

  const unique = [];
  const seen = new Set();
  for (const raw of vaultIds) {
    const id = String(raw || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  if (!unique.length) return { statuses, prompt: null };

  if (!pdfParse) {
    unique.forEach(id => statuses.push({ id, status: 'unsupported', reason: 'PDF summariser unavailable on server.' }));
    return { statuses, prompt: null };
  }

  const limitDocs = unique.slice(0, MAX_DOCS);
  const skipped = unique.slice(MAX_DOCS);

  const baseURL = `${req.protocol}://${req.get('host')}`;
  let usedChars = 0;
  const summaryBlocks = [];

  for (const id of limitDocs) {
    const viewUrl = `/api/vault/files/${encodeURIComponent(id)}/view`;
    const entry = { id, status: 'error', reason: 'Unknown error', viewUrl };
    try {
      const resp = await fetch(`${baseURL}${viewUrl}`, {
        headers: {
          ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {})
        }
      });

      if (!resp.ok) {
        entry.status = 'unavailable';
        entry.reason = `Unable to load document (HTTP ${resp.status})`;
        statuses.push(entry);
        continue;
      }

      const type = resp.headers.get('content-type') || '';
      if (!/pdf/i.test(type)) {
        entry.status = 'unsupported';
        entry.reason = 'Document is not a PDF';
        statuses.push(entry);
        continue;
      }

      const headerLen = Number(resp.headers.get('content-length'));
      if (Number.isFinite(headerLen) && headerLen > MAX_PDF_BYTES) {
        entry.status = 'too_large';
        entry.reason = `Document is ${formatBytes(headerLen)} (limit ${formatBytes(MAX_PDF_BYTES)}).`;
        statuses.push(entry);
        continue;
      }

      const arrBuf = await resp.arrayBuffer();
      const buf = Buffer.from(arrBuf);
      entry.sizeBytes = buf.length;
      entry.name = filenameFromDisposition(resp.headers.get('content-disposition')) || `Vault file ${id}`;

      if (buf.length > MAX_PDF_BYTES) {
        entry.status = 'too_large';
        entry.reason = `Document is ${formatBytes(buf.length)} (limit ${formatBytes(MAX_PDF_BYTES)}).`;
        statuses.push(entry);
        continue;
      }

      let parsed;
      try {
        parsed = await pdfParse(buf);
      } catch (err) {
        entry.status = 'error';
        entry.reason = 'Unable to read PDF contents';
        statuses.push(entry);
        continue;
      }

      const text = normaliseText(parsed?.text || '');
      if (!text) {
        entry.status = 'empty';
        entry.reason = 'No extractable text in PDF';
        statuses.push(entry);
        continue;
      }

      const available = MAX_TOTAL_DOC_CHARS - usedChars;
      if (available <= 0) {
        entry.status = 'skipped';
        entry.reason = 'Document skipped because summary budget was exhausted.';
        statuses.push(entry);
        continue;
      }

      const chunks = chunkForPrompt(text, MAX_DOC_CHARS, available);
      if (!chunks.length) {
        entry.status = 'skipped';
        entry.reason = 'Document truncated due to summary budget.';
        statuses.push(entry);
        continue;
      }

      const docLabel = entry.name || `Vault file ${id}`;
      const chunkSummary = chunks.map((chunk, idx) => `Chunk ${idx + 1}: ${chunk}`).join('\n');
      summaryBlocks.push(`Document "${docLabel}" (ID: ${id})\n${chunkSummary}`);
      const chunkChars = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      usedChars += chunkChars;

      entry.status = 'included';
      entry.summaryChars = chunkChars;
      statuses.push(entry);
    } catch (err) {
      entry.status = 'error';
      entry.reason = 'Unexpected error retrieving document';
      statuses.push(entry);
    }
  }

  for (const id of skipped) {
    statuses.push({
      id,
      status: 'skipped',
      reason: `Only the first ${MAX_DOCS} documents can be summarised at once.`,
      viewUrl: `/api/vault/files/${encodeURIComponent(id)}/view`
    });
  }

  const prompt = summaryBlocks.length
    ? [
        'You may cite the following vault documents provided by the user. Each entry contains extracted text (truncated).',
        'If you rely on a document, cite it inline as [Document: <title>] and explain how it informs your answer.',
        'If the documents are insufficient, acknowledge limitations explicitly.',
        '',
        summaryBlocks.join('\n\n')
      ].join('\n')
    : null;

  return { statuses, prompt };
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
    const sys = {
      role: 'system',
      content:
        "You are the AI Accountant Scenario Lab assistant. Be concise, helpful, and clear. " +
        "When giving numbers or steps, be explicit and ordered. Avoid storing any personal data."
    };

    const userSystem = messages[0]?.role === 'system' ? messages[0] : null;
    const restMessages = userSystem ? messages.slice(1) : messages;

    // Start SSE response to the browser
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    const { statuses: docStatuses, prompt: docPrompt } = await buildVaultContext(req, body.vaultFileIds);
    res.write(`data: ${JSON.stringify({ docStatuses })}\n\n`);

    const systemMessages = [];
    if (userSystem) systemMessages.push(userSystem);
    else systemMessages.push(sys);
    if (docPrompt) systemMessages.push({ role: 'system', content: docPrompt });

    const finalMessages = [...systemMessages, ...restMessages];

    // Prepare OpenAI request (streaming)
    const reqBody = {
      model: OPENAI_CHAT_MODEL,
      stream: true,
      messages: finalMessages
    };

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
