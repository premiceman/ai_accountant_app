'use strict';
const https = require('https');

const BASE_URL = process.env.DOCUPIPE_BASE_URL || 'https://app.docupipe.ai';
const API_KEY  = process.env.DOCUPIPE_API_KEY;

function requestJson(method, path, body) {
  return new Promise((resolve, reject) => {
    if (!API_KEY) return reject(new Error('DOCUPIPE_API_KEY not set'));
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const url = new URL(path, BASE_URL);
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
          err.status = res.statusCode; err.body = json; reject(err);
        } catch (e) { e.status = res.statusCode; reject(e); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function postDocument({ buffer, filename }) {
  const payload = { document: { file: { contents: buffer.toString('base64'), filename: filename || 'document.pdf' } } };
  // -> { documentId, jobId }
  return requestJson('POST', '/document', payload);
}

async function startStandardize({ documentId, schemaId, stdVersion }) {
  const body = { documentIds: [documentId], schemaId, ...(stdVersion ? { stdVersion } : {}) };
  // -> { jobId, standardizationIds }
  return requestJson('POST', '/v2/standardize/batch', body);
}

async function getJob(jobId) {
  return requestJson('GET', `/job/${encodeURIComponent(jobId)}`); // { status: 'processing'|'completed'|'failed', ... }
}

async function getStandardization(standardizationId) {
  return requestJson('GET', `/standardization/${encodeURIComponent(standardizationId)}`); // { data: {...} }
}

module.exports = { requestJson, postDocument, startStandardize, getJob, getStandardization };
