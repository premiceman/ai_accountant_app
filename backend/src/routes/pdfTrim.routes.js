'use strict';
const express = require('express');
const multer = require('multer');
const {
  analyzePdf,
  selectPages,
  trimBankStatement,
  buildTrimmedPdf,
} = require('../services/pdf/trimBankStatement');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

function parseKeptPages(input) {
  if (Array.isArray(input)) {
    return input.map((value) => Number(value)).filter((value) => Number.isInteger(value));
  }
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) {
        return parsed.map((value) => Number(value)).filter((value) => Number.isInteger(value));
      }
    } catch (err) {
      const parts = input.split(',').map((part) => Number(part.trim())).filter((value) => Number.isInteger(value));
      if (parts.length) return parts;
    }
  }
  return [];
}

router.post('/analyze', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file?.buffer) {
      return res.status(400).json({ ok: false, error: 'No file' });
    }
    const analysis = await analyzePdf(file.buffer);
    const selection = selectPages(analysis);
    const textsPreview = analysis.texts.map((text) => {
      if (!text) return '';
      const trimmed = text.trim();
      return trimmed.length > 800 ? `${trimmed.slice(0, 800)}…` : trimmed;
    });

    res.json({
      ok: true,
      pageCount: analysis.pageCount,
      scores: analysis.scores,
      flags: analysis.flags,
      texts: textsPreview,
      suggestedKeptPages: selection.keptPages,
      transactionRange: selection.transactionRange,
      minFirst: selection.minFirst,
      adjMargin: selection.adjMargin,
      highThreshold: selection.highThreshold,
      lowThreshold: selection.lowThreshold,
      keepAllRatio: selection.keepAllRatio,
    });
  } catch (err) {
    res.json({ ok: false, error: err?.message || 'TRIM_ANALYZE_ERROR' });
  }
});

router.post('/apply', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file?.buffer) {
      return res.status(400).json({ ok: false, error: 'No file' });
    }
    const keptPages = parseKeptPages(req.body?.keptPages);
    if (!keptPages.length) {
      return res.status(400).json({ ok: false, error: 'No pages selected' });
    }

    const result = await buildTrimmedPdf(file.buffer, keptPages);
    res.json({
      ok: true,
      mime: 'application/pdf',
      filename: (file.originalname || 'document.pdf').replace(/\.pdf$/i, '') + '.trimmed.pdf',
      data_base64: result.buffer.toString('base64'),
      meta: {
        keptPages: result.keptPages,
        originalPageCount: result.originalPageCount,
      },
    });
  } catch (err) {
    res.json({ ok: false, error: err?.message || 'TRIM_APPLY_ERROR' });
  }
});

router.post('/trim', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file?.buffer) {
      return res.status(400).json({ ok: false, error: 'No file' });
    }
    const minScore = Number(process.env.BANK_PDF_TRIM_MIN_SCORE ?? 5);
    const { buffer, keptPages, originalPageCount, scores, scoreByPage, transactionRange } = await trimBankStatement(file.buffer, { minScore });
    res.json({
      ok: true,
      mime: 'application/pdf',
      filename: (file.originalname || 'document.pdf').replace(/\.pdf$/i, '') + '.trimmed.pdf',
      data_base64: buffer.toString('base64'),
      meta: {
        keptPages,
        originalPageCount,
        scores,
        scoreByPage: scoreByPage || scores,
        transactionRange,
      },
    });
  } catch (err) {
    res.json({ ok: false, error: err?.message || 'TRIM_ERROR' });
  }
});

module.exports = router;
