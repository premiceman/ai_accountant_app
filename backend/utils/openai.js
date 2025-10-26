// backend/utils/openai.js
const crypto = require('crypto');

let fetchFn = globalThis.fetch;
if (!fetchFn) {
  try {
    fetchFn = require('node-fetch');
  } catch (err) {
    throw new Error('Fetch API unavailable and node-fetch not installed');
  }
}

const fetch = fetchFn;

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_CHAT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const FILE_SEARCH_LIMIT = Number(process.env.OPENAI_FILE_SEARCH_LIMIT || 6);

function ensureKey() {
  if (!OPENAI_API_KEY) {
    const err = new Error('OpenAI API key missing');
    err.status = 500;
    throw err;
  }
}

async function openaiFetch(path, options = {}) {
  ensureKey();
  const headers = Object.assign({}, options.headers, {
    Authorization: `Bearer ${OPENAI_API_KEY}`,
  });
  if (!(options.body instanceof FormData) && !(options.headers && options.headers['Content-Type'])) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(`${OPENAI_BASE_URL}${path}`, {
    ...options,
    headers,
  });
  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`OpenAI request failed: ${response.status}`);
    error.status = response.status;
    error.body = text;
    throw error;
  }
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
  return response.json();
}
  return response.text();
}

async function createVectorStore(namespace) {
  const payload = { name: namespace };
  const res = await openaiFetch('/vector_stores', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res;
}

async function uploadFileToVectorStore({ buffer, filename, mime, vectorStoreId }) {
  ensureKey();
  const form = new FormData();
  const blob = buffer instanceof Blob ? buffer : new Blob([buffer], { type: mime });
  form.append('file', blob, filename);
  form.append('purpose', 'assistants');

  const file = await openaiFetch('/files', {
    method: 'POST',
    body: form,
    headers: {},
  });

  await openaiFetch(`/vector_stores/${vectorStoreId}/files`, {
    method: 'POST',
    body: JSON.stringify({ file_id: file.id }),
  });

  return file;
}

async function ragQuery({ vectorStoreId, query, limit = FILE_SEARCH_LIMIT }) {
  const res = await openaiFetch(`/vector_stores/${vectorStoreId}/query`, {
    method: 'POST',
    body: JSON.stringify({ query, top_k: limit }),
  });
  const items = Array.isArray(res?.data) ? res.data : [];
  return items.map((item) => ({
    fileId: item.file_id,
    page: item.metadata?.page || item.chunk_metadata?.page || null,
    text: item.content || item.text || '',
    score: item.score ?? null,
  }));
}

function namespaceForProject(projectId) {
  return `project-${projectId}-${crypto.randomBytes(4).toString('hex')}`;
}

async function generateText({ system, prompt, temperature = 0.2 }) {
  const body = {
    model: OPENAI_CHAT_MODEL,
    messages: [
      { role: 'system', content: system || 'You are a helpful assistant.' },
      { role: 'user', content: prompt },
    ],
    temperature,
  };
  const res = await openaiFetch('/chat/completions', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const text = res?.choices?.[0]?.message?.content || '';
  return { text, raw: res };
}

module.exports = {
  ensureKey,
  createVectorStore,
  uploadFileToVectorStore,
  rag: {
    query: ragQuery,
  },
  namespaceForProject,
  generateText,
};
