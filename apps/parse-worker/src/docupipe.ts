import { getDocupipeConfig, resolveDocupipeLabel } from './config';
import { DocupipeDocumentStatus, DocupipeSubmission, DocumentType } from './types';
import { sleep } from './utils';

interface SubmitOptions {
  docType: DocumentType;
  mimeType: string;
  fileName?: string | null;
  metadata?: Record<string, unknown> | null;
}

interface DocupipeStatusResponse {
  id?: string;
  documentId?: string;
  status?: string;
  result?: unknown;
  data?: unknown;
  json?: unknown;
  metadata?: Record<string, unknown> | null;
  error?: { code?: string | null; message?: string | null } | null;
  submittedAt?: string | null;
  completedAt?: string | null;
  updatedAt?: string | null;
}

async function docupipeFetch(path: string, init: RequestInit): Promise<Response> {
  const config = getDocupipeConfig();
  const url = `${config.baseUrl}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  };
  if (init.headers) {
    const provided = init.headers as Record<string, string>;
    Object.assign(headers, provided);
  }
  const response = await fetch(url, { ...init, headers });
  return response;
}

export async function submitDocumentToDocupipe(
  buffer: Buffer,
  options: SubmitOptions
): Promise<DocupipeSubmission> {
  const payload = {
    filename: options.fileName || `${resolveDocupipeLabel(options.docType)}.pdf`,
    mimeType: options.mimeType || 'application/pdf',
    documentType: resolveDocupipeLabel(options.docType),
    data: buffer.toString('base64'),
    metadata: options.metadata || undefined,
  };

  const response = await docupipeFetch('/documents', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Docupipe upload failed: HTTP ${response.status} ${text}`);
  }

  const json = (await response.json().catch(() => null)) as DocupipeStatusResponse | null;
  if (!json?.id && !json?.documentId) {
    throw new Error('Docupipe upload did not return a document id');
  }

  return {
    documentId: json.id || json.documentId || '',
    status: json.status || 'queued',
    metadata: json.metadata || null,
  };
}

async function fetchDocupipeStatus(documentId: string): Promise<DocupipeDocumentStatus> {
  const response = await docupipeFetch(`/documents/${encodeURIComponent(documentId)}`, {
    method: 'GET',
  });

  if (response.status === 404) {
    throw new Error(`Docupipe document ${documentId} not found`);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Docupipe status request failed: HTTP ${response.status} ${text}`);
  }

  const json = (await response.json().catch(() => null)) as DocupipeStatusResponse | null;
  const rawStatus = String(json?.status || 'processing').toLowerCase();
  let status: DocupipeDocumentStatus['status'];
  switch (rawStatus) {
    case 'complete':
    case 'completed':
      status = 'completed';
      break;
    case 'failed':
    case 'error':
      status = 'failed';
      break;
    case 'processing':
    case 'in_progress':
    case 'in-progress':
      status = 'processing';
      break;
    default:
      status = 'queued';
  }
  const body = json?.result ?? json?.json ?? json?.data;
  return {
    id: json?.id || json?.documentId || documentId,
    status,
    json: body ?? null,
    metadata: json?.metadata || null,
    error: json?.error || null,
    submittedAt: json?.submittedAt || null,
    completedAt: json?.completedAt || null,
    updatedAt: json?.updatedAt || null,
  };
}

export async function waitForDocupipeResult(documentId: string): Promise<DocupipeDocumentStatus> {
  const config = getDocupipeConfig();
  const startedAt = Date.now();
  let lastStatus: DocupipeDocumentStatus | null = null;

  while (Date.now() - startedAt < config.pollTimeoutMs) {
    lastStatus = await fetchDocupipeStatus(documentId);
    if (lastStatus.status === 'completed') {
      if (typeof lastStatus.json === 'undefined' || lastStatus.json === null) {
        throw new Error('Docupipe completed without a JSON payload');
      }
      return lastStatus;
    }
    if (lastStatus.status === 'failed') {
      const reason = lastStatus.error?.message || 'Docupipe reported failure';
      throw new Error(reason);
    }
    await sleep(config.pollIntervalMs);
  }

  if (lastStatus?.status === 'completed') {
    return lastStatus;
  }

  throw new Error(
    `Docupipe processing timed out after ${config.pollTimeoutMs}ms (last status: ${lastStatus?.status || 'unknown'})`
  );
}
