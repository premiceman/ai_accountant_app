const express = require('express');
const mongoose = require('mongoose');
const { randomUUID } = require('crypto');
const DocumentInsight = require('../../models/DocumentInsight');
const UserDocumentJob = require('../../models/UserDocumentJob');
const { applyDocumentInsights, setInsightsProcessing } = require('../services/documents/insightsStore');
const { sha256 } = require('../lib/hash');
const { get: kvGet, set: kvSet } = require('../lib/kv');

const router = express.Router();

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireWorker(req, res, next) {
  const token = process.env.PARSE_WORKER_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'PARSE_WORKER_TOKEN not configured' });
  }
  const authHeader = req.headers.authorization || '';
  const [scheme, provided] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !provided || provided !== token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}

const PARSE_SESSION_TTL_SECONDS = 24 * 60 * 60;

function normalizeCollectionId(value) {
  if (!value) return null;
  try {
    return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : null;
  } catch (err) {
    return null;
  }
}

router.post('/parse-result', requireWorker, async (req, res) => {
  const { docId, userId, docType, storagePath, result } = req.body || {};
  if (!docId || !userId || !result) {
    return res.status(400).json({ error: 'docId, userId and result are required' });
  }

  const userObjectId = (() => {
    try {
      return new mongoose.Types.ObjectId(userId);
    } catch (err) {
      return null;
    }
  })();
  if (!userObjectId) {
    return res.status(400).json({ error: 'Invalid userId' });
  }

  const sessionKey = `parse:session:${docId}`;
  let sessionMeta = null;
  try {
    sessionMeta = await kvGet(sessionKey);
  } catch (err) {
    console.warn('[parse-result] Failed to load parse session metadata', err);
  }
  const sessionDocType = sessionMeta?.docType || null;

  const docupipe = isPlainObject(result?.docupipe) ? result.docupipe : {};
  const warnings = Array.isArray(result?.warnings)
    ? result.warnings.filter((entry) => typeof entry === 'string')
    : [];
  const metricsRaw = isPlainObject(result?.metrics) ? result.metrics : {};
  const metrics = {
    providerLatencyMs:
      metricsRaw?.providerLatencyMs != null ? Number(metricsRaw.providerLatencyMs) : null,
    totalLatencyMs: metricsRaw?.latencyMs != null ? Number(metricsRaw.latencyMs) : null,
  };
  if (!Number.isFinite(metrics.providerLatencyMs)) metrics.providerLatencyMs = null;
  if (!Number.isFinite(metrics.totalLatencyMs)) metrics.totalLatencyMs = null;

  const docupipeJson = docupipe?.json ?? null;
  const docupipeMetadata = isPlainObject(docupipe?.metadata) ? docupipe.metadata : null;
  const docupipeStatus = typeof docupipe?.status === 'string' ? docupipe.status : 'completed';
  const docupipeId = docupipe?.id || docupipe?.documentId || sessionMeta?.docupipeId || null;

  const insightKey = docType || sessionDocType || 'document';

  const narrative = [`Processed with Docupipe (${docupipeStatus})`];
  if (warnings.length) {
    narrative.push(`Docupipe warnings: ${warnings.join('; ')}`);
  }

  const metadataPayload = {
    provider: 'docupipe',
    extractionSource: 'docupipe',
    warnings,
    docupipe: {
      documentId: docupipeId,
      status: docupipeStatus,
      metadata: docupipeMetadata || null,
      timestamps: {
        submittedAt: docupipe?.submittedAt || null,
        completedAt: docupipe?.completedAt || null,
        updatedAt: docupipe?.updatedAt || null,
      },
      json: docupipeJson ?? null,
    },
    rawJson: docupipeJson ?? null,
  };

  const parserVersion = 'docupipe-v1';
  const schemaVersion = 'docupipe-v1';
  const promptVersion = 'docupipe';
  const model = 'docupipe';

  const metricsForInsights = {};
  if (metrics.providerLatencyMs != null) {
    metricsForInsights.providerLatencyMs = metrics.providerLatencyMs;
  }
  if (metrics.totalLatencyMs != null) {
    metricsForInsights.totalLatencyMs = metrics.totalLatencyMs;
  }

  try {
    await applyDocumentInsights(
      userObjectId,
      insightKey,
      {
        baseKey: insightKey,
        insightType: insightKey,
        metrics: metricsForInsights,
        metadata: metadataPayload,
        narrative,
        version: 'docupipe-v1',
        schemaVersion,
        parserVersion,
        promptVersion,
        model,
      },
      {
        id: docId,
        name: sessionMeta?.originalName || docId,
        uploadedAt: sessionMeta?.uploadedAt || null,
      }
    );

    await DocumentInsight.updateOne(
      { userId: userObjectId, fileId: docId, insightType: insightKey },
      {
        $set: {
          'metadata.provider': 'docupipe',
          'metadata.processor': null,
          'metadata.providerMetadata': docupipeMetadata || null,
          'metadata.classification': null,
          'metadata.warnings': warnings,
          'metadata.extractionSource': 'docupipe',
          'metadata.documentMetadata': docupipeMetadata || null,
          'metadata.docupipe': metadataPayload.docupipe,
          'metadata.rawJson': metadataPayload.rawJson,
        },
      }
    ).catch(() => {});

    const jobId = sessionMeta?.jobId || randomUUID();
    const resolvedStoragePath = storagePath || sessionMeta?.storagePath || null;
    const contentHash =
      sessionMeta?.contentHash ||
      sha256(
        [
          resolvedStoragePath || docId,
          docupipeStatus || 'unknown',
          JSON.stringify(docupipeMetadata || {}),
          docupipeJson == null ? '' : JSON.stringify(docupipeJson),
        ].join('|')
      );
    const collectionId = normalizeCollectionId(sessionMeta?.collectionId);
    const userRulesVersion = sessionMeta?.userRulesVersion || null;

    await UserDocumentJob.findOneAndUpdate(
      { userId: userObjectId, fileId: docId },
      {
        $set: {
          jobId,
          sessionId: sessionMeta?.sessionId || null,
          collectionId,
          originalName: sessionMeta?.originalName || docId,
          contentHash,
          candidateType: insightKey,
          status: 'succeeded',
          uploadState: 'succeeded',
          processState: 'succeeded',
          attempts: Number(sessionMeta?.attempts || 0),
          lastError: null,
          schemaVersion,
          parserVersion,
          promptVersion,
          model,
        },
      },
      { upsert: true, setDefaultsOnInsert: true }
    );

    const completionMeta = {
      ...(sessionMeta || {}),
      status: 'completed',
      completedAt: new Date().toISOString(),
      docId,
      jobId,
      userId: String(userObjectId),
      docType: insightKey,
      userRulesVersion,
      storagePath: resolvedStoragePath,
      contentHash,
      resultSummary: {
        extractionSource: 'docupipe',
        metricsExtracted: Object.keys(metricsForInsights || {}).length,
        docupipeStatus,
        warnings,
      },
      docupipeId,
      docupipeStatus,
    };
    try {
      await kvSet(sessionKey, completionMeta, PARSE_SESSION_TTL_SECONDS);
    } catch (err) {
      console.warn('[parse-result] Failed to persist parse session completion metadata', err);
    }

    await setInsightsProcessing(userObjectId, insightKey, {
      active: false,
      message: 'Docupipe JSON received',
      fileId: docId,
      fileName: sessionMeta?.originalName || docId,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to persist parse result', detail: err.message });
  }

  res.json({ ok: true });
});

module.exports = router;
