'use strict';
const https = require('https');
const { DOCUPIPE_WORKFLOW_ID, docupipeUrl } = require('../config/docupipe');
const { createLogger } = require('../lib/logger');

const API_KEY = process.env.DOCUPIPE_API_KEY;
const logger = createLogger({ name: 'docupipe:async' });

function requestJson(method, path, body) {
  return new Promise((resolve, reject) => {
    if (!API_KEY) {
      const err = new Error('DOCUPIPE_API_KEY not set');
      logger.error({ method, path }, 'DocuPipe request aborted: missing API key');
      return reject(err);
    }
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const url = docupipeUrl(path);
    const req = https.request(
      url,
      {
        method,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY,
          ...(data ? { 'Content-Length': data.length } : {}),
        },
      },
      (res) => {
        let chunks = '';
        res.on('data', (d) => {
          chunks += d;
        });
        res.on('end', () => {
          try {
            const json = chunks ? JSON.parse(chunks) : {};
            if (res.statusCode >= 200 && res.statusCode < 300) {
              return resolve(json);
            }
            const message = json?.error || `DocuPipe HTTP ${res.statusCode}`;
            const err = new Error(message);
            err.status = res.statusCode;
            err.body = json;
            logger.error({ method, path, status: res.statusCode, body: json }, 'DocuPipe request failed');
            reject(err);
          } catch (e) {
            e.status = res.statusCode;
            logger.error({ method, path, status: res.statusCode, error: e.message }, 'DocuPipe response parse failed');
            reject(e);
          }
        });
      }
    );
    req.on('error', (error) => {
      logger.error({ method, path, error: error.message }, 'DocuPipe request error');
      reject(error);
    });
    if (data) req.write(data);
    req.end();
  });
}

function buildWorkflowInput({ buffer, filename, typeHint, fileUrl }) {
  const input = {};
  if (fileUrl) {
    input.fileUrl = fileUrl;
  } else if (buffer) {
    input.file = {
      contents: buffer.toString('base64'),
      filename: filename || 'document.pdf',
    };
  }
  if (typeHint) input.typeHint = typeHint;
  return input;
}

async function dispatchWorkflow({ buffer, filename, typeHint, fileUrl }) {
  const input = buildWorkflowInput({ buffer, filename, typeHint, fileUrl });
  if (!input.file && !input.fileUrl) {
    throw new Error('DocuPipe workflow requires buffer or fileUrl');
  }
  const payload = { input };
  const response = await requestJson('POST', `/workflows/${DOCUPIPE_WORKFLOW_ID}/dispatch`, payload);
  const runId = response?.data?.id || response?.id || response?.runId;
  if (!runId) {
    const err = new Error('DocuPipe dispatch missing run id');
    err.response = response;
    throw err;
  }
  return {
    runId,
    documentId: runId,
    jobId: runId,
    response,
  };
}

async function getWorkflowRun(runId) {
  return requestJson('GET', `/workflow-runs/${encodeURIComponent(runId)}`);
}

function mapWorkflowStatus(payload) {
  const status = (payload?.data?.status || payload?.status || '').toLowerCase();
  if (status === 'succeeded' || status === 'completed') {
    return { status: 'completed', payload };
  }
  if (status === 'failed' || status === 'errored' || status === 'cancelled') {
    const error = payload?.data?.error || payload?.error || 'DocuPipe workflow failed';
    return { status: 'failed', error, payload };
  }
  return { status: 'processing', payload };
}

function extractWorkflowData(payload) {
  if (!payload) return {};
  if (payload?.data?.output != null) return payload.data.output;
  if (payload?.data?.result != null) return payload.data.result;
  if (payload?.data?.document || payload?.data?.documents) return payload.data;
  if (payload?.output != null) return payload.output;
  if (payload?.result != null) return payload.result;
  return payload;
}

async function postDocument({ buffer, filename, typeHint, fileUrl }) {
  return dispatchWorkflow({ buffer, filename, typeHint, fileUrl });
}

async function startStandardize({ documentId }) {
  return {
    jobId: documentId,
    standardizationIds: [documentId],
  };
}

async function getJob(jobId) {
  const run = await getWorkflowRun(jobId);
  return mapWorkflowStatus(run);
}

async function getStandardization(standardizationId) {
  const run = await getWorkflowRun(standardizationId);
  return {
    data: extractWorkflowData(run),
    payload: run,
  };
}

module.exports = {
  requestJson,
  postDocument,
  startStandardize,
  getJob,
  getStandardization,
  __private__: {
    buildWorkflowInput,
    dispatchWorkflow,
    getWorkflowRun,
    mapWorkflowStatus,
    extractWorkflowData,
  },
};
