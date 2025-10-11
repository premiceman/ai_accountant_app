'use strict';

const { extractPdfText } = require('./textExtractor');
const { classifyDocument } = require('./classifier');
const { buildInsights } = require('./insightBuilder');
const { getCatalogueEntry } = require('../catalogue');
const {
  DocumentClassificationError,
  UnsupportedDocumentError,
} = require('./errors');

const MIN_CONFIDENCE = 0.35;

async function buildInsightsForEntry(entry, text, originalName, context) {
  const insights = await buildInsights({ key: entry.key, text, context, originalName });
  if (!insights) {
    throw new UnsupportedDocumentError(`No insight builder registered for ${entry.key}`);
  }
  insights.key = entry.key;
  insights.baseKey = insights.baseKey || entry.key;
  insights.metadata = insights.metadata || {};
  return insights;
}

function buildInvalidResponse(entry, classification) {
  const reason = classification?.key
    ? `Uploaded file looks like ${classification.label}. Upload the document under ${classification.label}.`
    : `Uploaded file does not look like ${entry.label.toLowerCase()}.`;
  return {
    valid: false,
    reason,
    classification,
  };
}

async function analyseDocument(entry, buffer, originalName, context = {}) {
  if (!entry || !entry.key) {
    throw new UnsupportedDocumentError('Document entry missing.');
  }
  const text = await extractPdfText(buffer);
  const classification = classifyDocument({ text, originalName });
  if (!classification.key) {
    return buildInvalidResponse(entry, classification);
  }
  const matchesEntry = classification.key === entry.key;
  if (!matchesEntry && classification.confidence >= MIN_CONFIDENCE) {
    return buildInvalidResponse(entry, classification);
  }
  if (!matchesEntry && classification.confidence < MIN_CONFIDENCE) {
    // Heuristics inconclusive — allow processing but flag classification details
    console.warn('[documents:analyse] classification inconclusive', {
      expected: entry.key,
      detected: classification.key,
      confidence: classification.confidence,
    });
  }
  const insights = await buildInsightsForEntry(entry, text, originalName, context);
  return {
    valid: true,
    insights,
    text,
    classification,
  };
}

async function autoAnalyseDocument(buffer, originalName, context = {}) {
  const text = await extractPdfText(buffer);
  const classification = classifyDocument({ text, originalName });
  if (!classification.key) {
    throw new DocumentClassificationError('Could not determine document type from content.', {
      matches: classification.matches,
    });
  }
  const entry = getCatalogueEntry(classification.key);
  if (!entry) {
    throw new UnsupportedDocumentError(`Document type ${classification.key} is not supported.`);
  }
  const insights = await buildInsightsForEntry(entry, text, originalName, context);
  return {
    classification: { ...classification, entry },
    insights,
    text,
  };
}

module.exports = {
  analyseDocument,
  autoAnalyseDocument,
  classifyDocument,
};
