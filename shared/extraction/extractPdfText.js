'use strict';

let pdfParsePromise = null;
let fallbackWarned = false;
let testOverrides = null;
let ocrUnavailableLogged = false;

function getTestOverrides() {
  return testOverrides && typeof testOverrides === 'object' ? testOverrides : null;
}

async function loadPdfParse() {
  const overrides = getTestOverrides();
  if (overrides?.loadPdfParse) {
    try {
      return await overrides.loadPdfParse();
    } catch (err) {
      warnFallback('pdf-parse override failed; switching to OCR fallback.', err);
      return null;
    }
  }
  if (!pdfParsePromise) {
    pdfParsePromise = import('pdf-parse')
      .then((mod) => mod?.default ?? mod)
      .catch((err) => {
        warnFallback('pdf-parse unavailable, switching to OCR fallback.', err);
        return null;
      });
  }
  return pdfParsePromise;
}

function warnFallback(message, err) {
  if (fallbackWarned) return;
  fallbackWarned = true;
  if (err) {
    console.warn(`[shared:extractPdfText] ${message}`, err?.message || err);
  } else {
    console.warn(`[shared:extractPdfText] ${message}`);
  }
}

async function runOcr(buffer) {
  const overrides = getTestOverrides();
  if (overrides?.runOcr) {
    try {
      return await overrides.runOcr(buffer);
    } catch (err) {
      console.warn('[shared:extractPdfText] OCR override failed; returning raw text buffer.', err?.message || err);
      return '';
    }
  }
  try {
    const mod = await import('tesseract.js');
    const createWorker = mod?.createWorker ?? mod?.default?.createWorker;
    if (!createWorker) throw new Error('createWorker not available');
    const worker = await createWorker('eng');
    const { data } = await worker.recognize(buffer);
    await worker.terminate();
    return data?.text || '';
  } catch (err) {
    const message = err?.message || err;
    if (typeof message === 'string' && message.includes("Cannot find package 'tesseract.js'")) {
      if (!ocrUnavailableLogged) {
        console.info(
          "[shared:extractPdfText] OCR fallback unavailable because 'tesseract.js' is not installed. Skipping OCR fallback.",
        );
        ocrUnavailableLogged = true;
      }
    } else {
      console.warn('[shared:extractPdfText] OCR fallback failed; returning raw text buffer.', message);
    }
    return '';
  }
}

function normalisePages(text) {
  return text
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function extractPdfText(buffer) {
  if (!buffer || !buffer.length) {
    return { pages: [], fullText: '' };
  }

  let pages = [];
  let parsedText = '';

  const pdfParse = await loadPdfParse();
  if (pdfParse) {
    try {
      const data = await pdfParse(buffer);
      if (data?.text) {
        parsedText = String(data.text);
        pages = parsedText
          .split(/\f/g)
          .map((s) => s.trim())
          .filter(Boolean);
      }
    } catch (err) {
      warnFallback('pdf-parse failed; attempting OCR fallback.', err);
    }
  }

  if (!pages.length || pages.some((page) => page.length < 30)) {
    warnFallback('Parsed PDF text incomplete; invoking OCR fallback.');
    const ocrText = await runOcr(buffer);
    if (ocrText) {
      pages = normalisePages(ocrText);
    }
  }

  if (!pages.length && parsedText) {
    pages = normalisePages(parsedText);
  }

  if (!pages.length) {
    try {
      const raw = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : '';
      if (raw.trim().length) {
        pages = normalisePages(raw);
      }
    } catch (err) {
      console.warn('[shared:extractPdfText] Failed to convert buffer to text', err?.message || err);
    }
  }

  const fullText = pages.join('\n\n');
  return { pages, fullText };
}

module.exports = {
  extractPdfText,
  __private__: {
    setTestOverrides(overrides) {
      testOverrides = overrides || null;
      pdfParsePromise = null;
      fallbackWarned = false;
    },
    resetTestState() {
      testOverrides = null;
      pdfParsePromise = null;
      fallbackWarned = false;
      ocrUnavailableLogged = false;
    },
  },
};
