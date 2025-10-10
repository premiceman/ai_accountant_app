'use strict';

const pdfParse = require('pdf-parse');

async function extractPdfText(buffer) {
  if (!buffer || !buffer.length) return '';
  try {
    const parsed = await pdfParse(buffer);
    if (parsed && typeof parsed.text === 'string') {
      return parsed.text;
    }
  } catch (err) {
    console.warn('[documents:textExtractor] pdf-parse failed', err?.message || err);
    // fall through to heuristics below
  }

  // Fallback: if buffer looks like UTF-8 text (handy for tests/local fixtures), expose it
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
