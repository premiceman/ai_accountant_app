'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let sharedExtractorPromise = null;

function resolveShared(relativePath) {
  const candidates = [
    path.resolve(__dirname, '../../../../shared', relativePath),
    path.resolve(__dirname, '../../../../../shared', relativePath),
    path.resolve(process.cwd(), 'shared', relativePath),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return pathToFileURL(candidate).href;
    }
  }
  return null;
}

async function loadSharedExtractor() {
  if (!sharedExtractorPromise) {
    const url = resolveShared('extraction/extractPdfText.js');
    if (url) {
      sharedExtractorPromise = import(url).catch((err) => {
        console.warn('[documents:textExtractor] failed to load shared extractor', err?.message || err);
        return null;
      });
    } else {
      sharedExtractorPromise = Promise.resolve(null);
    }
  }
  return sharedExtractorPromise;
}

async function extractPdfText(buffer) {
  if (!buffer || !buffer.length) return '';
  try {
    const mod = await loadSharedExtractor();
    if (mod?.extractPdfText) {
      const result = await mod.extractPdfText(buffer);
      if (result?.fullText) {
        return result.fullText;
      }
      if (result?.pages) {
        return result.pages.join('\n\n');
      }
    }
  } catch (err) {
    console.warn('[documents:textExtractor] shared extractor failed', err?.message || err);
  }

  try {
    if (Buffer.isBuffer(buffer)) {
      const str = buffer.toString('utf8');
      if (str.trim().length) {
        return str;
      }
    }
  } catch (err) {
    console.warn('[documents:textExtractor] fallback conversion failed', err?.message || err);
  }
  return '';
}

module.exports = {
  extractPdfText,
};
