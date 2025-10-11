const express = require('express');
const mongoose = require('mongoose');
const auth = require('../../middleware/auth');
const FieldOverride = require('../../shared/models/fieldOverride');
const { parseDateString } = require('../../shared/config/dateParsing');

const router = express.Router();
router.use(auth);

const ALLOWED_TYPES = new Set(['number', 'integer', 'string', 'dateMMYYYY']);

function parseMoney(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const negative = /^\(|-/.test(trimmed) || /\bDR\b/i.test(trimmed);
  const cleaned = trimmed.replace(/[£$€]/g, '').replace(/CR|DR/gi, '').replace(/[(),]/g, '').trim();
  const parsed = Number.parseFloat(cleaned);
  if (Number.isNaN(parsed)) return null;
  return negative ? -parsed : parsed;
}

function coerceSample(value, dataType) {
  if (value == null) return null;
  switch (dataType) {
    case 'number':
    case 'integer': {
      const parsed = parseMoney(value);
      if (parsed == null) throw new Error('Expected a numeric example');
      return dataType === 'integer' ? Math.trunc(parsed) : parsed;
    }
    case 'dateMMYYYY': {
      const iso = parseDateString(value);
      if (!iso) throw new Error('Unable to parse date example');
      const [year, month] = iso.split('-');
      return `${month}/${year}`;
    }
    default:
      return String(value);
  }
}

router.post('/:docType/:fieldKey', async (req, res) => {
  const userId = req.user?.id;
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const docType = String(req.params.docType || '').trim();
  const fieldKey = String(req.params.fieldKey || '').trim();
  if (!docType || !fieldKey) {
    return res.status(400).json({ error: 'Invalid route parameters' });
  }

  const dataType = String(req.body?.dataType || '').trim();
  if (!ALLOWED_TYPES.has(dataType)) {
    return res.status(400).json({ error: 'Unsupported dataType' });
  }

  let sampleValue = null;
  if (Object.prototype.hasOwnProperty.call(req.body, 'sampleValue')) {
    try {
      sampleValue = coerceSample(req.body.sampleValue, dataType);
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Invalid sample value' });
    }
  }

  const selectorStrategy = {
    regex: req.body?.regex ?? req.body?.selectorStrategy?.regex ?? null,
    anchorLabel: req.body?.anchorLabel ?? req.body?.selectorStrategy?.anchorLabel ?? null,
    lineRange: req.body?.lineRange ?? req.body?.selectorStrategy?.lineRange ?? null,
    columnHint: req.body?.columnHint ?? req.body?.selectorStrategy?.columnHint ?? null,
    tokenizer: req.body?.tokenizer ?? req.body?.selectorStrategy?.tokenizer ?? null,
    hints: Array.isArray(req.body?.hints)
      ? req.body.hints
      : Array.isArray(req.body?.selectorStrategy?.hints)
      ? req.body.selectorStrategy.hints
      : undefined,
  };
  if (selectorStrategy.lineRange != null) {
    selectorStrategy.lineRange = Number.parseInt(selectorStrategy.lineRange, 10);
    if (Number.isNaN(selectorStrategy.lineRange)) selectorStrategy.lineRange = null;
  }
  const cleanedStrategy = Object.fromEntries(
    Object.entries(selectorStrategy).filter(([, value]) => value !== undefined && value !== null)
  );

  const enabled = req.body?.enabled === undefined ? true : Boolean(req.body.enabled);

  const payload = {
    userId,
    docType,
    fieldKey,
    dataType,
    selectorStrategy: cleanedStrategy,
    sampleValue,
    enabled,
  };

  const doc = await FieldOverride.findOneAndUpdate(
    { userId, docType, fieldKey },
    { $set: payload },
    { new: true, upsert: true, setDefaultsOnInsert: true, lean: true }
  );

  res.status(201).json(doc);
});

router.delete('/:docType/:fieldKey', async (req, res) => {
  const userId = req.user?.id;
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const docType = String(req.params.docType || '').trim();
  const fieldKey = String(req.params.fieldKey || '').trim();
  if (!docType || !fieldKey) {
    return res.status(400).json({ error: 'Invalid route parameters' });
  }

  await FieldOverride.deleteOne({ userId, docType, fieldKey });
  res.status(204).send();
});

module.exports = router;
