const { config } = require('../config');
const { docupipeUrl } = require('../../config/docupipe');
const { createLogger } = require('../utils/logger');

const logger = createLogger('docupipe');

function buildSubmissionDocument({ buffer, filename, typeHint }) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Docupipe requires a non-empty document buffer');
  }

  const document = {
    file: {
      contents: buffer.toString('base64'),
      filename: filename || 'document.pdf',
    },
  };

  if (typeHint) {
    document.typeHint = typeHint;
  }

  return document;
}

async function docupipeRequest(path, { method = 'GET', body, timeoutMs } = {}) {
  const url = docupipeUrl(path);
  const signal = timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined;

  const payload = body ? JSON.stringify(body) : undefined;

  const response = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-API-Key': config.docupipe.apiKey,
    },
    body: payload,
    signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const message = text || `Docupipe request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (error) {
    logger.warn('Failed to parse Docupipe JSON response', { path, error: error.message });
    throw error;
  }
}

async function submitDocument({ buffer, filename, typeHint }) {
  const document = buildSubmissionDocument({ buffer, filename, typeHint });

  const payload = {
    workflowId: config.docupipe.workflowId,
    document,
  };

  if (config.docupipe.dataset) {
    payload.dataset = config.docupipe.dataset;
  }

  logger.info('Submitting document to Docupipe workflow', {
    filename: document.file.filename,
    workflowId: config.docupipe.workflowId,
    ...(payload.dataset ? { dataset: payload.dataset } : {}),
  });

  const result = await docupipeRequest(
    `/v2/workflows/${encodeURIComponent(config.docupipe.workflowId)}/documents`,
    {
      method: 'POST',
      body: payload,
      timeoutMs: config.docupipe.connectTimeoutMs,
    }
  );

  if (!result?.documentId) {
    throw new Error('Docupipe submission response missing documentId');
  }

  return result;
}

async function waitForWorkflowJob(jobId) {
  const start = Date.now();
  let attempt = 0;

  for (;;) {
    const result = await docupipeRequest(`/v2/workflows/jobs/${encodeURIComponent(jobId)}`, {
      method: 'GET',
      timeoutMs: config.docupipe.connectTimeoutMs,
    });

    if (!result) {
      throw new Error('Docupipe job response was empty');
    }

    const status = result.status;
    if (status === 'completed' || status === 'failed') {
      return result;
    }

    const elapsed = Date.now() - start;
    if (elapsed >= config.docupipe.pollTimeoutMs) {
      const timeoutError = new Error('Docupipe workflow timeout');
      timeoutError.code = 'DOCUPIPE_TIMEOUT';
      throw timeoutError;
    }

    attempt += 1;
    const delay = Math.min(
      config.docupipe.pollIntervalMs * Math.max(1, attempt),
      Math.max(config.docupipe.pollIntervalMs * 4, 8000)
    );
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

async function fetchStandardization(documentId) {
  const payload = await docupipeRequest(
    `/v2/workflows/documents/${encodeURIComponent(documentId)}`,
    {
      method: 'GET',
      timeoutMs: config.docupipe.connectTimeoutMs,
    }
  );

  if (!payload) {
    throw new Error('Docupipe standardization response was empty');
  }

  if (payload.data !== undefined) {
    return payload;
  }

  if (Array.isArray(payload.standardizations) && payload.standardizations.length) {
    return payload.standardizations[0];
  }

  return payload;
}

function resolveDocupipeString(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (typeof value === 'object') {
      const nested = resolveDocupipeString(value.name, value.label, value.key, value.value, value.normalizedValue, value.normalisedValue);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

function summariseDocupipeResult(result) {
  if (!result || typeof result !== 'object') {
    return {};
  }

  const primarySource = result.data || result.document || (Array.isArray(result.documents) ? result.documents[0] : null) || result;

  const documentType = resolveDocupipeString(
    result.documentType,
    primarySource?.documentType,
    primarySource?.type,
    primarySource?.docType,
    primarySource?.schema,
    primarySource?.schemaName
  );

  const classification = resolveDocupipeString(
    result.classification,
    result.classification?.name,
    result.classification?.label,
    result.catalogue?.name,
    result.catalogue?.label,
    result.catalogue?.key,
    primarySource?.classification,
    primarySource?.classification?.name,
    primarySource?.classification?.label,
    primarySource?.catalogue?.name,
    primarySource?.catalogue?.label,
    primarySource?.catalogue?.key
  );

  const schema = resolveDocupipeString(
    result.schema,
    result.schemaName,
    primarySource?.schema,
    primarySource?.schemaName
  );

  const catalogueKey = resolveDocupipeString(
    result.catalogue?.key,
    primarySource?.catalogue?.key
  );

  const summary = {};
  if (documentType) {
    summary.documentType = documentType;
  }
  if (classification) {
    summary.classification = classification;
  }
  if (schema) {
    summary.schema = schema;
  }
  if (catalogueKey) {
    summary.catalogueKey = catalogueKey;
  }

  return summary;
}

async function runWorkflow({ buffer, filename, typeHint }) {
  const submission = await submitDocument({ buffer, filename, typeHint });

  if (submission.jobId) {
    const job = await waitForWorkflowJob(submission.jobId);
    if (job.status === 'failed') {
      const error = new Error(job.error || 'Docupipe job failed');
      error.details = job;
      throw error;
    }
  }

  const standardization = await fetchStandardization(submission.documentId);
  const summary = summariseDocupipeResult(standardization);

  logger.info('Docupipe workflow completed', {
    filename: filename || 'document.pdf',
    documentId: submission.documentId,
    ...(summary.documentType ? { documentType: summary.documentType } : {}),
    ...(summary.classification ? { classification: summary.classification } : {}),
    ...(summary.schema ? { schema: summary.schema } : {}),
    ...(summary.catalogueKey ? { catalogueKey: summary.catalogueKey } : {}),
  });

  return {
    ...standardization,
    docupipe: {
      documentId: submission.documentId,
      jobId: submission.jobId || null,
      ...(summary.documentType ? { documentType: summary.documentType } : {}),
      ...(summary.classification ? { classification: summary.classification } : {}),
      ...(summary.schema ? { schema: summary.schema } : {}),
      ...(summary.catalogueKey ? { catalogueKey: summary.catalogueKey } : {}),
    },
  };
}

module.exports = { runWorkflow };
