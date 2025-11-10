const { config } = require('../config');
const { createLogger } = require('../utils/logger');

const logger = createLogger('docupipe');

const SKIPPED_JOB_LOG_THROTTLE_MS = 60000;
const skippedJobLogCache = new Map();
const missingStandardizationLogCache = new Set();

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

function getDocupipeRequestConfig() {
  return {
    baseUrl: getDocupipeBaseUrl(),
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-API-Key': config.docupipe.apiKey,
    },
  };
}

async function parseDocupipeJson(response) {
  if (!response || typeof response !== 'object') {
    return {};
  }

  if (typeof response.json === 'function') {
    try {
      return await response.json();
    } catch (error) {
      logger.warn('Failed to parse DocuPipe JSON via response.json()', { error: error.message });
    }
  }

  if (typeof response.text === 'function') {
    const text = await response.text().catch(() => '');
    if (!text) {
      return {};
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      logger.warn('Failed to parse DocuPipe JSON via response.text()', { error: error.message });
    }
  }

  return {};
}

async function requestJson(method, path, body, { timeoutMs, context } = {}) {
  const url = docupipeUrl(path);
  const payload = body !== undefined ? JSON.stringify(body) : undefined;
  const signal = timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined;

  const { headers } = getDocupipeRequestConfig();

  const response = await fetch(url, {
    method,
    headers,
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

async function pollJobResilient(
  jobId,
  {
    initialDelayMs = 800,
    intervalMs = 1500,
    maxIntervalMs = 8000,
    notFoundGraceMs = 30000,
    timeoutMs = 180000,
    headers,
    baseUrl,
  } = {}
) {
  if (!jobId) {
    throw new Error('DocuPipe jobId is required');
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const start = Date.now();
  let first404At = null;
  let backoff = intervalMs;

  await sleep(initialDelayMs);

  for (;;) {
    const elapsed = Date.now() - start;
    if (elapsed > timeoutMs) {
      const timeoutError = new Error(`DocuPipe job timeout: ${jobId}`);
      timeoutError.code = 'DOCUPIPE_TIMEOUT';
      timeoutError.age = elapsed;
      throw timeoutError;
    }

    let res;
    let json = null;

    try {
      const url = new URL(`/job/${encodeURIComponent(jobId)}`, baseUrl || getDocupipeBaseUrl());
      res = await fetch(url, { method: 'GET', headers: headers || getDocupipeRequestConfig().headers });
      json = await parseDocupipeJson(res);
    } catch (error) {
      await sleep(backoff);
      backoff = Math.min(backoff * 1.6, maxIntervalMs);
      continue;
    }

    if (res.ok) {
      const status = (json?.status || json?.data?.status || '').toLowerCase();
      if (status === 'completed' || status === 'complete' || status === 'succeeded' || status === 'success') {
        return json;
      }
      if (status === 'failed' || status === 'error' || status === 'errored') {
        const err = new Error(`DocuPipe job failed: ${jobId}`);
        err.job = json;
        throw err;
      }
    } else if (res.status === 404) {
      if (!first404At) first404At = Date.now();
      const age = Date.now() - first404At;
      if (age < notFoundGraceMs) {
        await sleep(backoff);
        backoff = Math.min(backoff * 1.6, maxIntervalMs);
        continue;
      }
      const err = new Error(`DocuPipe job not found after ${age}ms: ${jobId}`);
      err.status = 404;
      err.response = json;
      err.age = age;
      throw err;
    } else if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after')) || backoff;
      await sleep(retryAfter);
      backoff = Math.min(backoff * 1.6, maxIntervalMs);
      continue;
    } else if (res.status >= 500 && res.status < 600) {
      await sleep(backoff);
      backoff = Math.min(backoff * 1.6, maxIntervalMs);
      continue;
    }

    await sleep(backoff);
    backoff = Math.min(backoff * 1.3, maxIntervalMs);
  }
}

async function getStandardizationWithRetry(
  standardizationId,
  { headers, baseUrl, attempts = 8, delayMs = 800 } = {}
) {
  if (!standardizationId) {
    throw new Error('DocuPipe standardizationId is required');
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  for (let i = 0; i < attempts; i += 1) {
    const url = new URL(
      `/standardization/${encodeURIComponent(standardizationId)}`,
      baseUrl || getDocupipeBaseUrl()
    );
    const response = await fetch(url, {
      method: 'GET',
      headers: headers || getDocupipeRequestConfig().headers,
    });

    if (response.ok) {
      return parseDocupipeJson(response);
    }

    if (response.status !== 404) {
      const text = typeof response.text === 'function' ? await response.text() : '';
      throw new Error(
        `GET /standardization/${standardizationId} failed: ${response.status} ${text}`
      );
    }

    await sleep(delayMs);
  }

  const error = new Error(`DocuPipe standardization still not found: ${standardizationId}`);
  error.status = 404;
  throw error;
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
  try {
    const { headers, baseUrl } = getDocupipeRequestConfig();
    const job = await pollJobResilient(jobId, {
      intervalMs,
      timeoutMs,
      headers,
      baseUrl,
    });
    clearSkippedJobLogs(jobId);
    return job;
  } catch (error) {
    const message = String(error?.message || '').toLowerCase();
    if (message.includes('not found')) {
      logSkippedJob(jobId, 'not_found', {
        candidate,
        jobType,
        elapsedMs: typeof error?.age === 'number' ? error.age : undefined,
        intervalMs,
      });
    }
    if (message.includes('timeout')) {
      logSkippedJob(jobId, 'timeout', {
        candidate,
        jobType,
        elapsedMs: typeof error?.age === 'number' ? error.age : undefined,
        intervalMs,
      });
    }
    throw error;
  }
}

async function getStandardization(standardizationId) {
  return requestJson('GET', `/standardization/${encodeURIComponent(standardizationId)}`);
}

async function waitForStandardization(
  standardizationId,
  {
    intervalMs = config.docupipe.pollIntervalMs || 1500,
    timeoutMs = config.docupipe.pollTimeoutMs || 120000,
  } = {}
) {
  if (!standardizationId) {
    throw new Error('DocuPipe standardizationId is required');
  }

  const start = Date.now();

  for (;;) {
    try {
      const result = await getStandardization(standardizationId);
      if (missingStandardizationLogCache.has(standardizationId)) {
        missingStandardizationLogCache.delete(standardizationId);
      }
      return result;
    } catch (error) {
      if (error?.status === 404) {
        if (!missingStandardizationLogCache.has(standardizationId)) {
          logger.error('DocuPipe standardization not found yet', { standardizationId });
          missingStandardizationLogCache.add(standardizationId);
        }

        if (Date.now() - start > timeoutMs) {
          const timeoutError = new Error(
            `DocuPipe standardization timeout: ${standardizationId}`
          );
          timeoutError.cause = error;
          throw timeoutError;
        }

        await new Promise((resolve) => setTimeout(resolve, intervalMs));
        continue;
      }

      throw error;
    }
  }
}

function extractStandardizationCandidates(resp) {
  const wf = resp?.workflowResponse || {};
  const out = [];

  const cls = wf.classifyStandardizeStep;
  if (cls?.classToStandardizationIds && cls?.classToStandardizationJobIds) {
    for (const k of Object.keys(cls.classToStandardizationIds)) {
      const stdId = cls.classToStandardizationIds[k];
      const stdJobId = cls.classToStandardizationJobIds[k];
      if (stdId && stdJobId) {
        out.push({
          source: 'classifyStandardizeStep',
          classKey: k,
          standardizationId: stdId,
          standardizationJobId: stdJobId,
          classificationJobId: cls.classificationJobId || null,
        });
      }
    }
  }

  const std = wf.standardizeStep;
  if (std?.standardizationIds?.length && std?.standardizationJobIds?.length) {
    std.standardizationIds.forEach((id, i) => {
      const jobId = std.standardizationJobIds[i];
      if (id && jobId) {
        out.push({
          source: 'standardizeStep',
          standardizationId: id,
          standardizationJobId: jobId,
        });
      }
    });
  }

  for (const step of Object.values(wf)) {
    if (step?.standardizationIds && step?.standardizationJobIds) {
      step.standardizationIds.forEach((id, i) => {
        const jobId = step.standardizationJobIds[i];
        if (id && jobId) {
          out.push({
            source: 'genericStep',
            standardizationId: id,
            standardizationJobId: jobId,
          });
        }
      });
    }
  }

  const seen = new Set();
  return out.filter((c) => {
    const key = `${c.standardizationJobId}|${c.standardizationId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

  const fetchStandardizationById = async (candidate, contextStatus, { wait } = {}) => {
    if (!candidate.standardizationId) return { data: null, status: contextStatus };
    try {
      const standardizationResponse = await (wait
        ? waitForStandardization(candidate.standardizationId)
        : getStandardization(candidate.standardizationId));
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

  const isCriticalCandidate = (candidate, index) => {
    if (!candidate) return false;
    if (candidate.standardizationJobId && stdJobId && candidate.standardizationJobId === stdJobId) {
      return true;
    }
    if (index === 0) return true;
    if ((candidate.source || '').toLowerCase() === 'standardizestep') return true;
    return false;
  };

  for (const [candidateIndex, candidate] of standardizationJobs.entries()) {
    let candidateJob = null;
    let candidateStatus = null;
    let candidateData = null;
    let shouldWaitForStandardization = !poll || !candidate.standardizationJobId;

    const candidateSource = candidate?.source || null;
    const candidateStep = typeof candidateSource === 'string' ? candidateSource : null;
    const criticalCandidate = isCriticalCandidate(candidate, candidateIndex);
    let skippedPoll = false;
    let pollError = null;

    if (poll && candidate.standardizationJobId) {
      try {
        candidateJob = await pollJob(candidate.standardizationJobId);
        candidateStatus = normaliseStatus(candidateJob) || candidateJob?.status || null;
        candidateData = extractStandardizationFromJob(candidateJob);
        completedJobs.push({ type: 'standardization', job: candidateJob, candidate });
        finalJob = candidateJob;
      } catch (error) {
        const causeStatus = error?.status || error?.cause?.status || null;
        const isNotFound = causeStatus === 404;
        const isTimeout = typeof error?.message === 'string' && error.message.toLowerCase().includes('timeout');

        if (!criticalCandidate && (isNotFound || isTimeout)) {
          skippedPoll = true;
          pollError = error;
          shouldWaitForStandardization = true;
          logger.warn('Skipping non-critical DocuPipe job after polling failure', {
            jobId: candidate.standardizationJobId,
            step: candidateStep,
            classKey: candidate.classKey || null,
            reason: isNotFound ? 'not_found' : 'timeout',
            error: error.message,
          });
          completedJobs.push({
            type: 'standardization',
            job: null,
            candidate,
            skipped: true,
            error: error.message,
            jobId: candidate.standardizationJobId || null,
            step: candidateStep,
          });
        } else {
          throw error;
        }
      }
    }

    if (!candidateData) {
      const fetched = await fetchStandardizationById(candidate, candidateStatus, {
        wait: shouldWaitForStandardization || skippedPoll,
      });
      candidateData = fetched.data;
      candidateStatus = fetched.status || candidateStatus || (skippedPoll ? 'skipped' : null);
    }

    standardizationResults.push({
      ...candidate,
      data: candidateData,
      status: candidateStatus,
      job: candidateJob,
      skipped: skippedPoll || undefined,
      pollError: skippedPoll ? pollError?.message || null : undefined,
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
  pollJobResilient,
  getJob,
  getStandardization,
  getStandardizationWithRetry,
  waitForStandardization,
  extractStandardizationCandidates,
  getDocupipeRequestConfig,
};
