const { config } = require('../config');
const { createLogger } = require('../utils/logger');

const logger = createLogger('docupipe');

function docupipeUrl(path) {
  return new URL(path, config.docupipe.baseUrl).toString();
}

async function requestJson(method, path, body, { timeoutMs, context } = {}) {
  const url = docupipeUrl(path);
  const payload = body !== undefined ? JSON.stringify(body) : undefined;
  const signal = timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined;

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
    const message = text
      ? `DocuPipe upload failed (${response.status}): ${text}`
      : `DocuPipe upload failed (${response.status})`;
    if (context) {
      logger.error(message, { ...context, status: response.status });
    }
    const error = new Error(message);
    error.status = response.status;
    error.responseText = text;
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
    logger.warn('Failed to parse DocuPipe JSON response', { path, error: error.message });
    throw error;
  }
}

function buildDocumentPayload({ fileUrl, buffer, filename, dataset = 'invoices', typeHint }) {
  const payload = {
    document: {},
    dataset,
    workflowId: config.docupipe.workflowId,
  };

  if (fileUrl) {
    payload.document.url = fileUrl;
  } else if (buffer) {
    payload.document.file = {
      contents: Buffer.isBuffer(buffer) ? buffer.toString('base64') : String(buffer),
      filename: filename || 'document.pdf',
    };
  } else {
    throw new Error('DocuPipe requires a fileUrl or buffer');
  }

  if (typeHint) {
    payload.typeHint = typeHint;
  }

  return payload;
}

async function submitWorkflow({ fileUrl, buffer, filename, dataset, typeHint }) {
  const payload = buildDocumentPayload({
    fileUrl,
    buffer,
    filename,
    dataset: dataset || config.docupipe.dataset || 'invoices',
    typeHint,
  });

  try {
    const response = await requestJson('POST', '/document', payload, {
      timeoutMs: config.docupipe.connectTimeoutMs,
      context: {
        workflowId: config.docupipe.workflowId,
        fileUrl: fileUrl || null,
        hasBuffer: Boolean(buffer),
      },
    });
    if (!response?.jobId) {
      const err = new Error('DocuPipe /document response missing jobId');
      err.response = response;
      throw err;
    }
    return response;
  } catch (error) {
    logger.error('DocuPipe upload failed', {
      workflowId: config.docupipe.workflowId,
      fileUrl: fileUrl || null,
      hasBuffer: Boolean(buffer),
      error: error.message,
    });
    throw error;
  }
}

async function getJob(jobId) {
  return requestJson('GET', `/job/${encodeURIComponent(jobId)}`);
}

async function pollJob(jobId, { intervalMs = config.docupipe.pollIntervalMs || 1500, timeoutMs = config.docupipe.pollTimeoutMs || 120000 } = {}) {
  const start = Date.now();
  for (;;) {
    const job = await getJob(jobId);
    const status = job?.status || job?.data?.status;
    if (status === 'completed') {
      return job;
    }
    if (status === 'failed') {
      const error = new Error(`DocuPipe job failed: ${jobId}`);
      error.job = job;
      throw error;
    }
    if (Date.now() - start > timeoutMs) {
      const error = new Error(`DocuPipe job timeout: ${jobId}`);
      error.job = job;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function getStandardization(standardizationId) {
  return requestJson('GET', `/standardization/${encodeURIComponent(standardizationId)}`);
}

function extractStandardizationFromJob(job) {
  if (!job || typeof job !== 'object') return null;
  if (job.result) return job.result;
  if (job.data?.result) return job.data.result;
  if (job.data?.output) return job.data.output;
  if (job.output) return job.output;
  if (Array.isArray(job.standardizations) && job.standardizations.length) {
    return job.standardizations[0];
  }
  if (Array.isArray(job.data?.standardizations) && job.data.standardizations.length) {
    return job.data.standardizations[0];
  }
  if (job.data) return job.data;
  return null;
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
      const nested = resolveDocupipeString(
        value.name,
        value.label,
        value.key,
        value.value,
        value.normalizedValue,
        value.normalisedValue
      );
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

  const primarySource =
    result.data
    || result.document
    || (Array.isArray(result.documents) ? result.documents[0] : null)
    || result;

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

async function runWorkflow({ fileUrl, buffer, filename, dataset, typeHint, poll = true }) {
  const submission = await submitWorkflow({ fileUrl, buffer, filename, dataset, typeHint });
  const uploadJobId = submission.jobId || null;
  const workflowResponse = submission.workflowResponse || {};
  const standardizeStep =
    workflowResponse.standardizeStep
    || workflowResponse.standardiseStep
    || {};
  const standardizationJobIds = standardizeStep.standardizationJobIds || standardizeStep.standardisationJobIds;
  const standardizationIds = standardizeStep.standardizationIds || standardizeStep.standardisationIds;

  const stdJobId = Array.isArray(standardizationJobIds)
    ? standardizationJobIds[0]
    : standardizeStep.standardizationJobId || standardizeStep.standardisationJobId || null;
  const stdId = Array.isArray(standardizationIds)
    ? standardizationIds[0]
    : standardizeStep.standardizationId || standardizeStep.standardisationId || null;

  let finalJob = null;
  let standardization = null;
  let status = null;

  if (poll) {
    const jobToPoll = stdJobId || uploadJobId;
    if (jobToPoll) {
      finalJob = await pollJob(jobToPoll);
      status = finalJob?.status || finalJob?.data?.status || null;
      standardization = extractStandardizationFromJob(finalJob);
    }
  }

  if (!standardization && stdId) {
    try {
      const standardizationResponse = await getStandardization(stdId);
      if (standardizationResponse) {
        standardization =
          standardizationResponse.data
          || standardizationResponse.document
          || standardizationResponse;
        status = status || standardizationResponse.status || standardizationResponse.data?.status || null;
      }
    } catch (error) {
      logger.warn('Failed to fetch DocuPipe standardization by id', {
        standardizationId: stdId,
        error: error.message,
      });
    }
  }

  const summary = summariseDocupipeResult(standardization);
  const resolvedStatus = status || (stdJobId ? 'running' : 'completed');

  const docupipeInfo = {
    documentId: submission.documentId || null,
    uploadJobId,
    standardizationJobId: stdJobId || null,
    standardizationId: stdId || null,
    status: resolvedStatus,
    ...(summary.documentType ? { documentType: summary.documentType } : {}),
    ...(summary.classification ? { classification: summary.classification } : {}),
    ...(summary.schema ? { schema: summary.schema } : {}),
    ...(summary.catalogueKey ? { catalogueKey: summary.catalogueKey } : {}),
  };

  return {
    data: standardization || null,
    docupipe: docupipeInfo,
    initialResponse: submission,
    finalJob,
  };
}

module.exports = {
  runWorkflow,
  pollJob,
  getJob,
};
