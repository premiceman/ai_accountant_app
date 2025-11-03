import https from 'node:https';

import { docupipeUrl } from '../config/docupipe.js';

type HttpMethod = 'GET' | 'POST';

type DocupipeError = NodeJS.ErrnoException & { status?: number; body?: unknown };

type RequestOptions = {
  method: HttpMethod;
  path: string;
  body?: Record<string, unknown> | null;
};

type SubmitDocumentOptions = {
  workflowId: string;
  filename: string;
  base64Contents?: string;
  signedUrl?: string;
};

type SubmitDocumentResponse = {
  documentId: string;
  jobId?: string | null;
  runId?: string | null;
};

type WorkflowJob = {
  status: 'queued' | 'processing' | 'completed' | 'failed';
  error?: string | null;
  documentId?: string;
  runId?: string;
  jobId?: string;
};

type StandardizationPayload = {
  data?: unknown;
  documentType?: string | null;
  schema?: string | null;
  classification?: { name?: string | null } | null;
  [key: string]: unknown;
};

const API_KEY = process.env.DOCUPIPE_API_KEY;

function ensureApiKey(): string {
  if (!API_KEY || !API_KEY.trim()) {
    throw new Error('DOCUPIPE_API_KEY not set');
  }
  return API_KEY.trim();
}

async function requestJson<T = Record<string, unknown>>({ method, path, body }: RequestOptions): Promise<T> {
  ensureApiKey();
  const dataBuffer = body ? Buffer.from(JSON.stringify(body)) : null;
  const url = docupipeUrl(path);

  return await new Promise<T>((resolve, reject) => {
    const req = https.request(
      url,
      {
        method,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-API-Key': ensureApiKey(),
          ...(dataBuffer ? { 'Content-Length': dataBuffer.length } : {}),
        },
      },
      (res) => {
        let chunks = '';
        res.on('data', (d) => {
          chunks += d;
        });
        res.on('end', () => {
          try {
            const json = chunks ? (JSON.parse(chunks) as T) : ({} as T);
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(json);
            } else {
              const err = new Error(
                (json as Record<string, unknown>)?.['error'] as string ||
                  `Docupipe HTTP ${res.statusCode}`
              );
              (err as DocupipeError).status = res.statusCode ?? 500;
              (err as DocupipeError).body = json;
              reject(err);
            }
          } catch (error) {
            (error as DocupipeError).status = res.statusCode ?? 500;
            reject(error);
          }
        });
      }
    );
    req.on('error', reject);
    if (dataBuffer) {
      req.write(dataBuffer);
    }
    req.end();
  });
}

export async function submitDocument({
  workflowId,
  filename,
  base64Contents,
  signedUrl,
}: SubmitDocumentOptions): Promise<SubmitDocumentResponse> {
  if (!workflowId) {
    throw new Error('DOCUPIPE_WORKFLOW_ID not configured');
  }

  const payload: Record<string, unknown> = {
    workflowId,
    document: base64Contents
      ? {
          file: {
            contents: base64Contents,
            filename: filename || 'document.pdf',
          },
        }
      : { url: signedUrl },
  };

  const result = (await requestJson({
    method: 'POST',
    path: `/v2/workflows/${encodeURIComponent(workflowId)}/documents`,
    body: payload,
  })) as SubmitDocumentResponse;

  if (!result?.documentId) {
    throw new Error('Docupipe submission missing documentId');
  }

  return result;
}

export async function getWorkflowJob(jobId: string): Promise<WorkflowJob> {
  if (!jobId) {
    throw new Error('Docupipe jobId is required');
  }

  const payload = (await requestJson({
    method: 'GET',
    path: `/v2/workflows/jobs/${encodeURIComponent(jobId)}`,
  })) as WorkflowJob;

  if (!payload?.status) {
    throw new Error('Docupipe job response missing status');
  }

  return payload;
}

export async function fetchStandardization(documentId: string): Promise<StandardizationPayload> {
  if (!documentId) {
    throw new Error('Docupipe documentId is required');
  }

  const payload = (await requestJson({
    method: 'GET',
    path: `/v2/workflows/documents/${encodeURIComponent(documentId)}`,
  })) as StandardizationPayload;

  if (payload?.data !== undefined) {
    return payload;
  }

  if (Array.isArray(payload?.['standardizations'])) {
    const [first] = payload['standardizations'] as StandardizationPayload[];
    if (first?.data !== undefined) {
      return first;
    }
  }

  return payload;
}

export async function waitForWorkflowJob(
  jobId: string,
  {
    intervalMs,
    timeoutMs,
  }: {
    intervalMs: number;
    timeoutMs: number;
  }
): Promise<WorkflowJob> {
  const start = Date.now();
  let delay = Math.max(500, intervalMs);

  for (;;) {
    const result = await getWorkflowJob(jobId);
    if (result.status === 'completed' || result.status === 'failed') {
      return result;
    }

    await new Promise((resolve) => setTimeout(resolve, delay));
    if (Date.now() - start >= timeoutMs) {
      const timeoutError = new Error('Docupipe workflow timeout');
      (timeoutError as NodeJS.ErrnoException).code = 'DOCUPIPE_TIMEOUT';
      throw timeoutError;
    }

    delay = Math.min(delay + intervalMs, Math.max(intervalMs * 4, 8000));
  }
}

export type { WorkflowJob, StandardizationPayload, SubmitDocumentResponse };
