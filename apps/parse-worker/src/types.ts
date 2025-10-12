export type DocumentType = string;

export interface ParseJob {
  docId: string;
  userId: string;
  storagePath: string;
  docType: DocumentType;
  userRulesVersion?: string | null;
  dedupeKey?: string | null;
  attempts?: number;
  source?: string | null;
  mimeType?: string | null;
  originalName?: string | null;
}

export interface DocupipeConfig {
  baseUrl: string;
  apiKey: string;
  pollIntervalMs: number;
  pollTimeoutMs: number;
}

export interface DocupipeSubmission {
  documentId: string;
  status: string;
  metadata?: Record<string, unknown> | null;
}

export interface DocupipeDocumentStatus {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  json?: unknown;
  metadata?: Record<string, unknown> | null;
  error?: { code?: string | null; message?: string | null } | null;
  submittedAt?: string | null;
  completedAt?: string | null;
  updatedAt?: string | null;
}

export interface ParseResultPayload {
  ok: boolean;
  provider: 'docupipe';
  docType: DocumentType;
  docId: string;
  docupipe: DocupipeDocumentStatus;
  storage: {
    path: string;
    processedAt: string;
  };
  metrics: {
    latencyMs: number;
    providerLatencyMs: number | null;
  };
  warnings: string[];
}
