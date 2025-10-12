const express = require('express');
const mongoose = require('mongoose');
const DocumentInsight = require('../../models/DocumentInsight');
const { applyDocumentInsights } = require('../services/documents/insightsStore');

const router = express.Router();

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
  const positions = {};
  Object.entries(fieldValues).forEach(([field, entry]) => {
    if (!entry || typeof entry !== 'object') return;
    const source = entry.source || 'heuristic';
    if (source === 'rule' && entry.value != null) {
      preferred[field] = entry.value;
    } else if (entry.value != null && !(field in preferred)) {
      fallback[field] = entry.value;
    }
    if (Array.isArray(entry.positions) && entry.positions.length) {
      positions[field] = entry.positions;
    }
  });
  return { preferred, fallback, positions };
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
  const { preferred, fallback, positions } = normaliseValues(fieldValues);

  const metrics = { ...(insights.metrics || {}) };
  Object.entries(preferred).forEach(([field, value]) => {
    if (typeof value === 'number') {
      metrics[field] = value;
    }
  });

  const extractionSource = metadata.extractionSource || 'heuristic';
  const insightKey = docType || 'document';
  try {
    await applyDocumentInsights(
      userObjectId,
      insightKey,
      {
        baseKey: insightKey,
        insightType: insightKey,
        metrics,
        metadata: {
          ...metadata,
          extractedFields: {
            preferred,
            fallback,
            positions: Object.keys({ ...(metadata.fieldPositions || {}), ...positions }).length
              ? { ...(metadata.fieldPositions || {}), ...positions }
              : undefined,
          },
          extractionSource,
        },
        narrative,
        text,
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
          'metadata.issues': Array.isArray(result.softErrors) ? result.softErrors : [],
        },
      }
    ).catch(() => {});
  } catch (err) {
    return res.status(500).json({ error: 'Failed to persist parse result', detail: err.message });
  }

  res.json({ ok: true });
});

module.exports = router;
