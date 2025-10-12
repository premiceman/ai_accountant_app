'use strict';
const express = require('express');
const multer = require('multer');
const { trimBankStatement } = require('../services/pdf/trimBankStatement');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/trim', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file?.buffer) return res.status(400).json({ ok:false, error:'No file' });
    const minScore = Number(process.env.BANK_PDF_TRIM_MIN_SCORE ?? 5);
    const { buffer, keptPages, originalPageCount, scoreByPage } = await trimBankStatement(file.buffer, { minScore });
    res.json({
      ok: true,
      mime: 'application/pdf',
      filename: (file.originalname || 'document.pdf').replace(/\.pdf$/i,'') + '.trimmed.pdf',
      data_base64: buffer.toString('base64'),
      meta: { keptPages, originalPageCount, scoreByPage }
    });
  } catch (e) {
    res.json({ ok:false, error: e.message || 'TRIM_ERROR' });
  }
});

module.exports = router;
