const dayjs = require('dayjs');
const User = require('../../../models/User');
const DocumentInsight = require('../../../models/DocumentInsight');
const { sha256 } = require('../../lib/hash');
const { normaliseDocumentInsight } = require('./insightNormaliser');
const {
  buildAggregatesFromVault,
  buildTimelineFromVault,
} = require('./jsonAnalytics');

const LEGACY_SCHEMA_VERSION = 'legacy-v1';
const LEGACY_PARSER_VERSION = 'legacy-parser-v1';
const LEGACY_PROMPT_VERSION = 'legacy-prompt-v1';
const LEGACY_MODEL = 'legacy-ingest';

function mergeFileReference(existing = [], fileInfo) {
  const filtered = existing.filter((item) => item.id !== fileInfo.id);
  filtered.unshift({
    id: fileInfo.id,
    name: fileInfo.name,
    uploadedAt: fileInfo.uploadedAt,
  });
  return filtered.slice(0, 5);
}

function normaliseDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const iso = value.toISOString();
    return iso;
  }
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date.toISOString();
  const match = String(value).match(/(\d{4}-\d{2}-\d{2})/);
  if (match) return `${match[1]}T00:00:00.000Z`;
  return null;
}


function isoFromValue(value) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date.toISOString();
  const str = String(value);
  const match = str.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`;
  const alt = str.match(/(\d{2})[\/\-.](\d{2})[\/\-.](\d{2,4})/);
  if (alt) {
    const day = alt[1].padStart(2, '0');
    const month = alt[2].padStart(2, '0');
    const year = alt[3].length === 2 ? `20${alt[3]}` : alt[3].padStart(4, '0');
    return `${year}-${month}-${day}T00:00:00.000Z`;
  }
  return null;
}

function monthKeyFromIsoSafe(iso) {
  if (!iso) return null;
  const match = String(iso).match(/(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : null;
}

function deriveDocumentContext(insights = {}, fileInfo = {}) {
  const metadata = insights.metadata || {};
  const metrics = insights.metrics || {};
  const candidates = [
    metadata.documentDate,
    metrics.payDate,
    metadata.payDate,
    metadata.period?.end,
    metadata.period?.start,
    metrics.periodEnd,
    metrics.periodStart,
  ];
  const txList = Array.isArray(insights.transactions) ? insights.transactions : [];
  txList.forEach((tx) => {
    if (tx?.date) candidates.push(tx.date);
  });
  if (Array.isArray(metadata.statementPeriods)) {
    metadata.statementPeriods.forEach((period) => {
      if (period?.end) candidates.push(period.end);
      if (period?.start) candidates.push(period.start);
    });
  }
  if (fileInfo?.uploadedAt) candidates.push(fileInfo.uploadedAt);

  let documentIso = null;
  for (const value of candidates) {
    const iso = isoFromValue(value);
    if (iso) {
      documentIso = iso;
      break;
    }
  }

  const monthKey = monthKeyFromIsoSafe(documentIso);
  const label = monthKey ? dayjs(documentIso).format('MMM YYYY') : null;
  const documentName = metadata.documentName || metadata.personName || metadata.accountHolder || fileInfo?.name || null;
  const nameMatchesUser = metadata.nameMatchesUser ?? null;

  return {
    documentIso,
    monthKey,
    label,
    documentName,
    nameMatchesUser,
  };
}




async function applyDocumentInsights(userId, key, insights, fileInfo) {
  if (!userId || !key || !insights) return null;
  const doc = await User.findById(userId, 'documentInsights').lean();
  const current = doc?.documentInsights || {};
  const sources = { ...(current.sources || {}) };
  const storeKey = insights.storeKey || key;
  const baseKey = insights.baseKey || key;
  const existing = sources[storeKey] || {};
  const normalised = normaliseDocumentInsight({
    ...insights,
    baseKey,
    catalogueKey: insights.catalogueKey || baseKey,
  });
  const mergedMetadata = { ...(insights.metadata || {}), ...(normalised.metadata || {}) };
  const metricsV1 = normalised.metricsV1 || existing.metricsV1 || insights.metricsV1 || null;
  const mergedInsights = {
    ...insights,
    metrics: normalised.metrics,
    metricsV1,
    metadata: mergedMetadata,
  };
  const documentContext = deriveDocumentContext(mergedInsights, fileInfo);
  sources[storeKey] = {
    ...existing,
    key: storeKey,
    baseKey,
    metrics: normalised.metrics || existing.metrics || {},
    metricsV1,
    narrative: insights.narrative || existing.narrative || [],
    transactions: insights.transactions || existing.transactions || [],
    metadata: {
      ...(existing.metadata || {}),
      ...mergedMetadata,
      documentMonth: documentContext.monthKey || existing.metadata?.documentMonth || null,
      documentLabel: documentContext.label || existing.metadata?.documentLabel || null,
      documentDate: documentContext.documentIso || existing.metadata?.documentDate || null,
      documentName: documentContext.documentName || existing.metadata?.documentName || null,
      nameMatchesUser: documentContext.nameMatchesUser ?? existing.metadata?.nameMatchesUser ?? null,
    },
    period: insights.metadata?.period || insights.metrics?.period || existing.period || null,
    files: fileInfo ? mergeFileReference(existing.files, fileInfo) : (existing.files || []),
  };

  const processing = { ...(current.processing || {}) };
  processing[baseKey] = {
    ...(processing[baseKey] || {}),
    active: false,
    message: fileInfo?.name ? `Updated from ${fileInfo.name}` : 'Analytics refreshed',
    updatedAt: new Date(),
  };

  const newState = {
    sources,
    aggregates: buildAggregatesFromVault(sources),
    timeline: buildTimelineFromVault(sources),
    processing,
    updatedAt: new Date(),
  };

  await User.findByIdAndUpdate(userId, {
    $set: {
      documentInsights: newState,
    },
  }).exec().catch((err) => {
    console.warn('[documents:insightsStore] failed to persist insights', err);
  });

  if (fileInfo?.id) {
    try {
      const now = new Date();
      const extractionSource =
        mergedInsights.metadata?.extractionSource || mergedInsights.metrics?.extractionSource || 'heuristic';
      const currency = mergedInsights.metadata?.currency || 'GBP';
      const documentIso = documentContext.documentIso || null;
      const documentDate = documentIso ? new Date(documentIso) : null;
      const documentDateV1 = documentIso ? documentIso.slice(0, 10) : null;
      const insightType = mergedInsights.insightType || mergedInsights.baseKey || baseKey;
      const contentHash = sha256(
        [
          fileInfo.id,
          documentIso || '',
          JSON.stringify(normalised.metrics || {}),
          JSON.stringify(mergedInsights.transactions || []),
        ].join('|')
      );

      await DocumentInsight.findOneAndUpdate(
        { userId, fileId: fileInfo.id, insightType },
        {
          $set: {
            catalogueKey: key,
            baseKey,
            insightType,
            documentMonth: documentContext.monthKey || null,
            documentDate,
            documentLabel: documentContext.label || null,
            documentName: documentContext.documentName || null,
            nameMatchesUser: documentContext.nameMatchesUser,
            metrics: normalised.metrics || {},
            metricsV1,
            metadata: {
              ...mergedMetadata,
              documentMonth: documentContext.monthKey || null,
              documentLabel: documentContext.label || null,
              documentDate: documentIso || null,
            },
            transactions: Array.isArray(mergedInsights.transactions) ? mergedInsights.transactions : [],
            narrative: Array.isArray(mergedInsights.narrative) ? mergedInsights.narrative : [],
            extractedAt: now,
            updatedAt: now,
            schemaVersion: LEGACY_SCHEMA_VERSION,
            parserVersion: LEGACY_PARSER_VERSION,
            promptVersion: LEGACY_PROMPT_VERSION,
            model: extractionSource === 'openai' ? 'openai-legacy' : LEGACY_MODEL,
            extractionSource,
            contentHash,
            version: 'legacy-sync',
            currency,
            documentDateV1,
          },
          $setOnInsert: {
            createdAt: now,
          },
        },
        { upsert: true, setDefaultsOnInsert: true }
      ).exec();
    } catch (err) {
      console.warn('[documents:insightsStore] failed to upsert document insight', err);
    }
  }

  return newState;
}

async function setInsightsProcessing(userId, key, state) {
  if (!userId || !key) return null;
  const path = `documentInsights.processing.${key}`;
  try {
    if (!state) {
      await User.findByIdAndUpdate(userId, { $unset: { [path]: '' } }).exec();
      return null;
    }
    const payload = {
      active: Boolean(state.active),
      message: state.message || null,
      updatedAt: new Date(),
    };
    if (state.step) payload.step = state.step;
    if (state.progress != null) payload.progress = state.progress;
    if (state.fileId) payload.fileId = state.fileId;
    if (state.fileName) payload.fileName = state.fileName;
    await User.findByIdAndUpdate(userId, { $set: { [path]: payload } }).exec();
    return payload;
  } catch (err) {
    console.warn('[documents:insightsStore] failed to set processing state', err);
    return null;
  }
}

module.exports = {
  applyDocumentInsights,
  setInsightsProcessing,
};
