const express = require('express');
const mongoose = require('mongoose');
const DocumentInsight = require('../../models/DocumentInsight');
const { applyDocumentInsights } = require('../services/documents/insightsStore');

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

function normaliseValues(fieldValues = {}) {
  const preferred = {};
  const fallback = {};
  Object.entries(fieldValues).forEach(([field, entry]) => {
    if (!entry || typeof entry !== 'object') return;
    const source = entry.source || 'heuristic';
    if (source === 'rule' && entry.value != null) {
      preferred[field] = entry.value;
    } else if (entry.value != null && !(field in preferred)) {
      fallback[field] = entry.value;
    }
  });
  return { preferred, fallback };
}

router.post('/parse-result', requireWorker, async (req, res) => {
  const { docId, userId, docType, result } = req.body || {};
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

  const { fieldValues = {}, metadata = {}, insights = {}, narrative = [], text = '' } = result;
  const schematic = isPlainObject(result?.schematic) ? result.schematic : null;
  const schematicVersion = schematic?.version || metadata.rulesVersion || null;
  const { preferred, fallback } = normaliseValues(fieldValues);

  const metrics = { ...(insights.metrics || {}) };
  Object.entries(preferred).forEach(([field, value]) => {
    if (typeof value === 'number') {
      metrics[field] = value;
    }
  });

  const extractionSource = schematicVersion
    ? `schematic@${schematicVersion}`
    : metadata.extractionSource || 'heuristic';
  const insightKey = docType || 'document';

  const structuredFields = {
    preferred,
    fallback,
    raw: fieldValues,
  };
  if (schematicVersion) {
    structuredFields.version = schematicVersion;
  }
  if (schematic?.fields && isPlainObject(schematic.fields)) {
    structuredFields.schematic = schematic.fields;
  }

  const positions = isPlainObject(schematic?.positions) ? schematic.positions : null;
  const transactionsV1 = (() => {
    if (Array.isArray(schematic?.transactions)) {
      return schematic.transactions.filter((entry) => isPlainObject(entry));
    }
    if (isPlainObject(schematic?.transactions) && Array.isArray(schematic.transactions.items)) {
      return schematic.transactions.items.filter((entry) => isPlainObject(entry));
    }
    return null;
  })();

  const metricsV1 = isPlainObject(schematic?.metrics) ? schematic.metrics : null;

  const metadataPayload = {
    ...metadata,
    extractedFields: structuredFields,
    extractionSource,
  };
  if (schematicVersion) {
    metadataPayload.schematicVersion = schematicVersion;
  }
  if (positions) {
    metadataPayload.positions = positions;
  }
  if (schematic && !metadataPayload.schematic) {
    metadataPayload.schematic = {
      version: schematicVersion,
      docType: schematic.docType || docType || null,
      provider: schematic.provider || 'schematic',
    };
  }
  try {
    await applyDocumentInsights(
      userObjectId,
      insightKey,
      {
        baseKey: insightKey,
        insightType: insightKey,
        metrics,
        metadata: metadataPayload,
        narrative,
        text,
        metricsV1: metricsV1 || null,
        transactionsV1: transactionsV1 || null,
        version: schematicVersion ? 'v1' : undefined,
        schemaVersion: schematicVersion ? 'schematic-v1' : undefined,
        parserVersion: schematic?.parserVersion || (schematicVersion ? `schematic@${schematicVersion}` : undefined),
        promptVersion: schematic?.promptVersion || undefined,
        model: schematic?.model || (schematicVersion ? 'schematic' : undefined),
      },
      {
        id: docId,
        name: docId,
        uploadedAt: null,
      }
    );

    await DocumentInsight.updateOne(
      { userId: userObjectId, fileId: docId, insightType: insightKey },
      {
        $set: {
          'metadata.rulesVersion': metadata.rulesVersion || null,
          'metadata.schematicVersion': schematicVersion || metadata.rulesVersion || null,
          'metadata.issues': Array.isArray(result.softErrors) ? result.softErrors : [],
          'metadata.extractionSource': extractionSource,
          'metadata.extractedFields': metadataPayload.extractedFields,
          'metadata.positions': positions || null,
        },
      }
    ).catch(() => {});
  } catch (err) {
    return res.status(500).json({ error: 'Failed to persist parse result', detail: err.message });
  }

  res.json({ ok: true });
});

module.exports = router;
