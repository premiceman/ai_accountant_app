'use strict';

const { extractPdfText } = require('./textExtractor');
const { classifyDocument } = require('./classifier');
const { getCatalogueEntry } = require('../catalogue');
const { DocumentClassificationError, UnsupportedDocumentError } = require('./errors');

const MIN_CONFIDENCE = 0.35;

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
  return {
    valid: true,
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
  return {
    classification: { ...classification, entry },
    text,
  };
}

module.exports = {
  analyseDocument,
  autoAnalyseDocument,
  classifyDocument,
};
