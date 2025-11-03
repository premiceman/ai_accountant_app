'use strict';
const https = require('https');
const { docupipeUrl } = require('../config/docupipe');

const API_KEY  = process.env.DOCUPIPE_API_KEY;

function requestJson(method, path, body) {
  return new Promise((resolve, reject) => {
    if (!API_KEY) return reject(new Error('DOCUPIPE_API_KEY not set'));
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const url = docupipeUrl(path);
    const req = https.request(url, {
      method,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
        ...(data ? { 'Content-Length': data.length } : {})
      }
    }, (res) => {
      let chunks = '';
      res.on('data', d => chunks += d);
      res.on('end', () => {
        try {
          const json = chunks ? JSON.parse(chunks) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) return resolve(json);
          const err = new Error(json?.error || `DocuPipe HTTP ${res.statusCode}`);
          err.status = res.statusCode; err.body = json;
          reject(err);
        } catch (e) { e.status = res.statusCode; reject(e); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function postDocument({ buffer, filename }) {
  const contents = buffer.toString('base64');
  const payload = { document: { file: { contents, filename: filename || 'document.pdf' } } };
  // POST /document -> { documentId, jobId }
  return requestJson('POST', '/document', payload);
}

async function getJob(jobId) {
  return requestJson('GET', `/job/${encodeURIComponent(jobId)}`);
}

async function waitForJob(jobId, { timeoutMs = 60000, initialDelay = 800 } = {}) {
  let delay = initialDelay, elapsed = 0;
  for (;;) {
    const j = await getJob(jobId);
    if (j?.status && j.status !== 'processing') return j;
    await new Promise(r => setTimeout(r, delay));
    elapsed += delay;
    if (elapsed >= timeoutMs) {
      const err = new Error('DocuPipe job timed out');
      err.code = 'DOCUPIPE_TIMEOUT'; err.job = j;
      throw err;
    }
    delay = Math.min(Math.round(delay * 1.75), 8000);
  }
}

async function getDocument(documentId) {
  return requestJson('GET', `/document/${encodeURIComponent(documentId)}`);
}

module.exports = { postDocument, waitForJob, getDocument };
