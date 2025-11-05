const { config } = require('../config');
const { createLogger } = require('../utils/logger');

const logger = createLogger('docupipe');

const skippedJobLogCache = new Map();
const SKIPPED_JOB_LOG_THROTTLE_MS = 30_000;

let cachedBaseUrl = null;
let baseUrlWarningLogged = false;

function buildCandidateLogMetadata(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  return {
    classKey: candidate.classKey || null,
    standardizationJobId: candidate.standardizationJobId || null,
    standardizationId: candidate.standardizationId || null,
    classificationJobId: candidate.classificationJobId || null,
    source: candidate.source || null,
  };
}

function skippedJobLogKey(jobId, reason) {
  return `${jobId}:${reason}`;
}

function clearSkippedJobLogs(jobId) {
  if (!jobId) return;
  skippedJobLogCache.delete(skippedJobLogKey(jobId, 'not_found'));
  skippedJobLogCache.delete(skippedJobLogKey(jobId, 'timeout'));
}

function logSkippedJob(jobId, reason, { candidate, jobType, elapsedMs, intervalMs } = {}) {
  if (!jobId || !reason) return;
  const key = skippedJobLogKey(jobId, reason);
  const now = Date.now();
  const last = skippedJobLogCache.get(key) || 0;
  if (now - last < SKIPPED_JOB_LOG_THROTTLE_MS) {
    return;
  }
  skippedJobLogCache.set(key, now);

  const meta = {
    jobId,
    reason,
    ...(jobType ? { jobType } : {}),
    ...(typeof elapsedMs === 'number' ? { elapsedMs } : {}),
    ...(typeof intervalMs === 'number' ? { intervalMs } : {}),
  };

  const candidateMeta = buildCandidateLogMetadata(candidate);
  if (candidateMeta) {
    meta.candidate = candidateMeta;
  }

  logger.warn('DocuPipe job skipped', meta);
}

function getDocupipeBaseUrl() {
  if (cachedBaseUrl) return cachedBaseUrl;

  const rawBase = config.docupipe.baseUrl || 'https://app.docupipe.ai';

  try {
    const parsed = new URL(rawBase);
    const hasPath = parsed.pathname && parsed.pathname !== '/';
    const hasQuery = Boolean(parsed.search);
    const hasHash = Boolean(parsed.hash);

    if ((hasPath || hasQuery || hasHash) && !baseUrlWarningLogged) {
      logger.warn('DocuPipe baseUrl contained extra path/query; normalizing to origin', {
        baseUrl: rawBase,
        origin: parsed.origin,
      });
      baseUrlWarningLogged = true;
    }

    cachedBaseUrl = parsed.origin;
  } catch (error) {
    if (!baseUrlWarningLogged) {
      logger.warn('DocuPipe baseUrl invalid, defaulting to https://app.docupipe.ai', {
        baseUrl: rawBase,
        error: error.message,
      });
      baseUrlWarningLogged = true;
    }
    cachedBaseUrl = 'https://app.docupipe.ai';
  }

  return cachedBaseUrl;
}

function docupipeUrl(path) {
  return new URL(path, getDocupipeBaseUrl()).toString();
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

function buildDocumentPayload({ fileUrl, fileBase64, buffer, filename, dataset = 'invoices', typeHint }) {
  const payload = {
    document: {},
    dataset,
    workflowId: config.docupipe.workflowId,
  };

  if (fileUrl) {
    payload.document.url = fileUrl;
  } else if (fileBase64) {
    payload.document.file = {
      contents: String(fileBase64),
      filename: filename || 'document.pdf',
    };
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

async function postDocumentWithWorkflow({
  fileUrl,
  fileBase64,
  buffer,
  filename,
  dataset,
  typeHint,
}) {
  const payload = buildDocumentPayload({
    fileUrl,
    fileBase64,
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
        hasBuffer: Boolean(buffer) || Boolean(fileBase64),
        dataset: payload.dataset,
      },
    });
    if (!response?.jobId) {
      const err = new Error('DocuPipe /document response missing jobId');
      err.response = response;
      throw err;
    }

    const candidates = extractStandardizationCandidates(response);
    if (!Array.isArray(candidates) || candidates.length === 0) {
      logger.error('DocuPipe did not return standardization ids', { response });
      const err = new Error('DocuPipe did not return standardization ids');
      err.response = response;
      err.status = 502;
      throw err;
    }

    const primaryCandidate = candidates[0] || {};
    const stdJobId = primaryCandidate.standardizationJobId || null;
    const stdId = primaryCandidate.standardizationId || null;

    const uploadJobId = response.jobId || null;
    const classificationJobId =
      response?.workflowResponse?.classifyStandardizeStep?.classificationJobId || null;

    const standardizationJobs = candidates.map((candidate) => ({
      classKey: candidate.classKey || null,
      standardizationJobId: candidate.standardizationJobId || null,
      standardizationId: candidate.standardizationId || null,
      classificationJobId: candidate.classificationJobId || classificationJobId || null,
      source: candidate.source || null,
    }));

    logger.info('DocuPipe workflow submitted', {
      uploadJobId,
      classificationJobId,
      standardizationJobId: stdJobId,
      standardizationId: stdId,
      standardizationJobIds: standardizationJobs
        .map((job) => job.standardizationJobId)
        .filter(Boolean),
    });

    return {
      initial: response,
      uploadJobId,
      stdJobId,
      stdId,
      candidates,
      classificationJobId,
      standardizationJobs,
    };
  } catch (error) {
    logger.error('DocuPipe upload failed', {
      workflowId: config.docupipe.workflowId,
      fileUrl: fileUrl || null,
      hasBuffer: Boolean(buffer) || Boolean(fileBase64),
      error: error.message,
    });
    throw error;
  }
}

async function getJob(jobId) {
  return requestJson('GET', `/job/${encodeURIComponent(jobId)}`);
}

async function pollJob(
  jobId,
  {
    intervalMs = config.docupipe.pollIntervalMs || 1500,
    timeoutMs = config.docupipe.pollTimeoutMs || 120000,
    candidate = null,
    jobType = null,
  } = {}
) {
  const start = Date.now();
  for (;;) {
    let job;
    try {
      job = await getJob(jobId);
      clearSkippedJobLogs(jobId);
    } catch (error) {
      if (error?.status === 404) {
        logSkippedJob(jobId, 'not_found', {
          candidate,
          jobType,
          elapsedMs: Date.now() - start,
          intervalMs,
        });
        if (Date.now() - start > timeoutMs) {
          logSkippedJob(jobId, 'timeout', {
            candidate,
            jobType,
            elapsedMs: Date.now() - start,
            intervalMs,
          });
          const timeoutError = new Error(`DocuPipe job timeout: ${jobId}`);
          timeoutError.cause = error;
          throw timeoutError;
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
        continue;
      }
      throw error;
    }
    const status = (job?.status || job?.data?.status || '').toLowerCase();
    if (status === 'completed' || status === 'complete' || status === 'succeeded' || status === 'success') {
      return job;
    }
    if (status === 'failed' || status === 'error' || status === 'errored') {
      const error = new Error(`DocuPipe job failed: ${jobId}`);
      error.job = job;
      throw error;
    }
    if (Date.now() - start > timeoutMs) {
      logSkippedJob(jobId, 'timeout', {
        candidate,
        jobType,
        elapsedMs: Date.now() - start,
        intervalMs,
      });
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

function extractStandardizationCandidates(resp) {
  const wf = resp?.workflowResponse;
  if (!wf || typeof wf !== 'object') return [];

  const std = wf.standardizeStep;
  if (std?.standardizationIds?.length && std?.standardizationJobIds?.length) {
    return std.standardizationIds.map((id, i) => ({
      standardizationId: id,
      standardizationJobId: std.standardizationJobIds[i],
      source: 'standardizeStep',
    }));
  }

  const cls = wf.classifyStandardizeStep;
  if (cls?.classToStandardizationIds && cls?.classToStandardizationJobIds) {
    const out = [];
    for (const key of Object.keys(cls.classToStandardizationIds)) {
      out.push({
        classKey: key,
        standardizationId: cls.classToStandardizationIds[key],
        standardizationJobId: cls.classToStandardizationJobIds[key],
        classificationJobId: cls.classificationJobId,
        source: 'classifyStandardizeStep',
      });
    }
    return out;
  }

  const out = [];
  for (const step of Object.values(wf)) {
    if (step?.standardizationIds && step?.standardizationJobIds) {
      step.standardizationIds.forEach((id, index) => {
        out.push({
          standardizationId: id,
          standardizationJobId: step.standardizationJobIds[index],
          source: 'genericStep',
        });
      });
    }
  }

  return out;
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
  const submission = await postDocumentWithWorkflow({
    fileUrl,
    buffer,
    filename,
    dataset,
    typeHint,
  });
  const uploadJobId = submission.uploadJobId || null;
  const classificationJobId = submission.classificationJobId || null;
  const stdJobId = submission.stdJobId || null;
  const stdId = submission.stdId || null;
  const standardizationJobs = submission.standardizationJobs || submission.candidates || [];

  const completedJobs = [];
  const standardizationResults = [];

  const normaliseStatus = (job) => (job?.status || job?.data?.status || '').toLowerCase() || null;

  const fetchStandardizationById = async (candidate, contextStatus) => {
    if (!candidate.standardizationId) return { data: null, status: contextStatus };
    try {
      const standardizationResponse = await getStandardization(candidate.standardizationId);
      if (standardizationResponse) {
        const responseStatus =
          standardizationResponse.status
          || standardizationResponse.data?.status
          || contextStatus
          || null;
        const payload =
          standardizationResponse.data
          || standardizationResponse.document
          || standardizationResponse;
        return { data: payload, status: responseStatus };
      }
    } catch (error) {
      logger.warn('Failed to fetch DocuPipe standardization by id', {
        standardizationId: candidate.standardizationId,
        jobId: candidate.standardizationJobId || null,
        error: error.message,
      });
    }
    return { data: null, status: contextStatus };
  };

  if (poll && uploadJobId) {
    const uploadJob = await pollJob(uploadJobId, { jobType: 'upload' });
    completedJobs.push({ type: 'upload', job: uploadJob });
  }

  if (poll && classificationJobId) {
    const classificationJob = await pollJob(classificationJobId, { jobType: 'classification' });
    completedJobs.push({ type: 'classification', job: classificationJob });
  }

  let finalJob = null;

  for (const candidate of standardizationJobs) {
    let candidateJob = null;
    let candidateStatus = null;
    let candidateData = null;

    if (poll && candidate.standardizationJobId) {
      candidateJob = await pollJob(candidate.standardizationJobId, {
        candidate,
        jobType: 'standardization',
      });
      candidateStatus = normaliseStatus(candidateJob) || candidateJob?.status || null;
      candidateData = extractStandardizationFromJob(candidateJob);
      completedJobs.push({ type: 'standardization', job: candidateJob, candidate });
      finalJob = candidateJob;
    }

    if (!candidateData) {
      const fetched = await fetchStandardizationById(candidate, candidateStatus);
      candidateData = fetched.data;
      candidateStatus = fetched.status;
    }

    standardizationResults.push({
      ...candidate,
      data: candidateData,
      status: candidateStatus,
      job: candidateJob,
    });
  }

  const primaryResult = standardizationResults[0] || null;
  const standardization = primaryResult?.data || null;
  const status = primaryResult?.status || normaliseStatus(finalJob) || (stdJobId ? 'running' : 'completed');

  const summary = summariseDocupipeResult(standardization);

  const docupipeInfo = {
    documentId: submission.initial?.documentId || null,
    uploadJobId,
    classificationJobId: classificationJobId || null,
    standardizationJobId: stdJobId || null,
    standardizationId: stdId || null,
    standardizationJobs: standardizationResults.map((result) => ({
      classKey: result.classKey || null,
      standardizationJobId: result.standardizationJobId || null,
      standardizationId: result.standardizationId || null,
      status: result.status || null,
    })),
    status,
    ...(summary.documentType ? { documentType: summary.documentType } : {}),
    ...(summary.classification ? { classification: summary.classification } : {}),
    ...(summary.schema ? { schema: summary.schema } : {}),
    ...(summary.catalogueKey ? { catalogueKey: summary.catalogueKey } : {}),
  };

  return {
    data: standardization || null,
    docupipe: docupipeInfo,
    initialResponse: submission.initial,
    finalJob,
    standardizations: standardizationResults,
    jobs: completedJobs,
  };
}

module.exports = {
  postDocumentWithWorkflow,
  runWorkflow,
  pollJob,
  getJob,
  getStandardization,
  extractStandardizationCandidates,
};
