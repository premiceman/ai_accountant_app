const { config } = require('../config');
const { docupipeUrl } = require('../../config/docupipe');
const { createLogger } = require('../utils/logger');

const logger = createLogger('docupipe');

function buildPayload({ buffer, filename, typeHint }) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Docupipe requires a non-empty document buffer');
  }

  const payload = {
    document: {
      file: {
        contents: buffer.toString('base64'),
        filename: filename || 'document.pdf',
      },
    },
    dataset: config.docupipe.dataset,
    workflowId: config.docupipe.workflowId,
  };

  if (typeHint) {
    payload.document.typeHint = typeHint;
  }

  return payload;
}

async function runWorkflow({ buffer, filename, typeHint }) {
  const url = config.docupipe.documentUrl || docupipeUrl('/document');
  const payload = buildPayload({ buffer, filename, typeHint });

  logger.info('Submitting document to Docupipe workflow', {
    filename: payload.document.file.filename,
    dataset: payload.dataset,
    workflowId: payload.workflowId,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-API-Key': config.docupipe.apiKey,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(config.docupipe.connectTimeoutMs),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Docupipe request failed (${response.status}): ${text}`);
  }

  const result = await response.json();
  logger.info('Docupipe workflow response received', {
    filename: payload.document.file.filename,
  });
  return result;
}

module.exports = { runWorkflow };
