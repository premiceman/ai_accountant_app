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
  const wf = resp?.workflowResponse;
  if (!wf || typeof wf !== 'object') return [];

  const seen = new Set();
  const orderedCandidates = [];
  const candidateIndexByKey = new Map();
  const processedSteps = new Set();

  const addCandidate = (candidate) => {
    if (!candidate || !candidate.standardizationId) return;

    const key = `${candidate.standardizationId || ''}::${candidate.classKey || ''}`;
    if (candidateIndexByKey.has(key)) {
      const existingIndex = candidateIndexByKey.get(key);
      const existing = orderedCandidates[existingIndex];
      if (!existing.standardizationJobId && candidate.standardizationJobId) {
        existing.standardizationJobId = candidate.standardizationJobId;
      }
      if (!existing.classificationJobId && candidate.classificationJobId) {
        existing.classificationJobId = candidate.classificationJobId;
      }
      if (!existing.source && candidate.source) {
        existing.source = candidate.source;
      }
      return;
    }

    const entry = {
      standardizationId: candidate.standardizationId,
      standardizationJobId: candidate.standardizationJobId || null,
      classKey: candidate.classKey || null,
      classificationJobId: candidate.classificationJobId || null,
      source: candidate.source || null,
    };

    orderedCandidates.push(entry);
    candidateIndexByKey.set(key, orderedCandidates.length - 1);
  };

  const addFromIndexedStep = (step, source) => {
    if (!step || typeof step !== 'object') return;

    const ids = Array.isArray(step.standardizationIds)
      ? step.standardizationIds
      : step.standardizationIds
      ? [step.standardizationIds]
      : [];
    const jobIds = Array.isArray(step.standardizationJobIds)
      ? step.standardizationJobIds
      : step.standardizationJobIds
      ? [step.standardizationJobIds]
      : [];
    const classKeys = Array.isArray(step.classKeys) ? step.classKeys : [];

    ids.forEach((id, index) => {
      addCandidate({
        standardizationId: id,
        standardizationJobId: jobIds[index] || jobIds[0] || null,
        classKey: classKeys[index] || step.classKey || null,
        classificationJobId: step.classificationJobId || null,
        source,
      });
    });

    if (!ids.length && step.standardizationId) {
      addCandidate({
        standardizationId: step.standardizationId,
        standardizationJobId: step.standardizationJobId || jobIds[0] || null,
        classKey: step.classKey || null,
        classificationJobId: step.classificationJobId || null,
        source,
      });
    }
  };

  const addFromClassMapStep = (step, source) => {
    if (!step || typeof step !== 'object') return;

    const idMap = step.classToStandardizationIds || {};
    const jobMap = step.classToStandardizationJobIds || {};
    for (const key of Object.keys(idMap)) {
      addCandidate({
        classKey: key,
        standardizationId: idMap[key],
        standardizationJobId: jobMap[key] || null,
        classificationJobId: step.classificationJobId || null,
        source,
      });
    }

    if (step.standardizationId) {
      addCandidate({
        standardizationId: step.standardizationId,
        standardizationJobId: step.standardizationJobId || null,
        classificationJobId: step.classificationJobId || null,
        source,
      });
    }
  };

  const registerStep = (name, extractor) => {
    if (!wf[name]) return;
    processedSteps.add(name);
    extractor(wf[name], name);
  };

  registerStep('standardizeReviewStep', addFromIndexedStep);
  registerStep('classifyStandardizeStep', addFromClassMapStep);
  registerStep('splitClassifyStandardizeStep', addFromClassMapStep);
  registerStep('splitStandardizeStep', addFromIndexedStep);
  registerStep('standardizeStep', addFromIndexedStep);

  for (const [name, step] of Object.entries(wf)) {
    if (processedSteps.has(name)) continue;

    if (step?.classToStandardizationIds && step?.classToStandardizationJobIds) {
      addFromClassMapStep(step, name);
      continue;
    }

    if (step?.standardizationIds || step?.standardizationId) {
      addFromIndexedStep(step, name);
    }
  }

  return orderedCandidates;
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
  getJob,
  getStandardization,
  waitForStandardization,
  extractStandardizationCandidates,
};
