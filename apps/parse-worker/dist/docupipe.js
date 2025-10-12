"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.submitDocumentToDocupipe = submitDocumentToDocupipe;
exports.waitForDocupipeResult = waitForDocupipeResult;
const config_1 = require("./config");
const utils_1 = require("./utils");
async function docupipeFetch(path, init) {
    const config = (0, config_1.getDocupipeConfig)();
    const url = `${config.baseUrl}${path}`;
    const headers = {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
    };
    if (init.headers) {
        const provided = init.headers;
        Object.assign(headers, provided);
    }
    const response = await fetch(url, { ...init, headers });
    return response;
}
async function submitDocumentToDocupipe(buffer, options) {
    const payload = {
        filename: options.fileName || `${(0, config_1.resolveDocupipeLabel)(options.docType)}.pdf`,
        mimeType: options.mimeType || 'application/pdf',
        documentType: (0, config_1.resolveDocupipeLabel)(options.docType),
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
    const json = (await response.json().catch(() => null));
    if (!json?.id && !json?.documentId) {
        throw new Error('Docupipe upload did not return a document id');
    }
    return {
        documentId: json.id || json.documentId || '',
        status: json.status || 'queued',
        metadata: json.metadata || null,
    };
}
async function fetchDocupipeStatus(documentId) {
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
    const json = (await response.json().catch(() => null));
    const rawStatus = String(json?.status || 'processing').toLowerCase();
    let status;
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
async function waitForDocupipeResult(documentId) {
    const config = (0, config_1.getDocupipeConfig)();
    const startedAt = Date.now();
    let lastStatus = null;
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
        await (0, utils_1.sleep)(config.pollIntervalMs);
    }
    if (lastStatus?.status === 'completed') {
        return lastStatus;
    }
    throw new Error(`Docupipe processing timed out after ${config.pollTimeoutMs}ms (last status: ${lastStatus?.status || 'unknown'})`);
}
