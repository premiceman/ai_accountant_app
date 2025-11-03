const { setTimeout: delay } = require('node:timers/promises');
const { config } = require('../config');
const {
  DOCUPIPE_WORKFLOW_ID,
  docupipeUrl,
} = require('../../config/docupipe');
const { createLogger } = require('../utils/logger');

const logger = createLogger('docupipe');

async function submitWorkflow({ fileUrl, typeHint }) {
  const dispatchUrl = docupipeUrl(`/workflows/${DOCUPIPE_WORKFLOW_ID}/dispatch`);
  const response = await fetch(dispatchUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.docupipe.apiKey}`,
    },
    body: JSON.stringify({ input: { fileUrl, typeHint } }),
    signal: AbortSignal.timeout(config.docupipe.connectTimeoutMs),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Docupipe dispatch failed (${response.status}): ${text}`);
  }
  return response.json();
}

async function pollWorkflow(runId) {
  const deadline = Date.now() + config.docupipe.pollTimeoutMs;
  while (Date.now() < deadline) {
    const pollUrl = docupipeUrl(`/workflow-runs/${runId}`);
    const response = await fetch(pollUrl, {
      headers: { Authorization: `Bearer ${config.docupipe.apiKey}` },
      signal: AbortSignal.timeout(config.docupipe.connectTimeoutMs),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Docupipe poll failed (${response.status}): ${text}`);
    }
    const payload = await response.json();
    const state = payload?.data?.status || payload?.status;
    if (state === 'succeeded') {
      return payload?.data || payload;
    }
    if (state === 'failed' || state === 'cancelled') {
      const reason = payload?.data?.error || payload?.error || 'Docupipe workflow failed';
      const err = new Error(reason);
      err.payload = payload;
      throw err;
    }
    await delay(config.docupipe.pollIntervalMs);
  }
  throw new Error('Docupipe workflow timed out');
}

async function runWorkflow({ fileUrl, typeHint }) {
  const dispatch = await submitWorkflow({ fileUrl, typeHint });
  const runId = dispatch?.data?.id || dispatch?.id;
  if (!runId) {
    throw new Error('Docupipe dispatch missing run id');
  }
  logger.info('Dispatched Docupipe workflow', { runId, typeHint });
  const result = await pollWorkflow(runId);
  logger.info('Docupipe workflow complete', { runId });
  return result;
}

module.exports = { runWorkflow };
