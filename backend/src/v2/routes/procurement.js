const express = require('express');
const dayjs = require('dayjs');
const { requireFeature } = require('../middleware/requireFeature');
const ProcurementVendor = require('../models/ProcurementVendor');
const { mongoose } = require('../models');
const { badRequest, notFound } = require('../utils/errors');
const { generateRelationshipBrief } = require('../services/procurementAi');

const router = express.Router();

function toPlainVendor(doc) {
  if (!doc) return null;
  const json = doc.toObject({ versionKey: false });
  json.id = String(json._id);
  delete json._id;
  return json;
}

function extractVendorPayload(body = {}) {
  const allowedFields = [
    'name',
    'category',
    'stage',
    'owner',
    'annualValue',
    'currency',
    'renewalDate',
    'paymentTerms',
    'relationshipHealth',
    'riskLevel',
    'tags',
    'contacts',
    'objectives',
    'risks',
    'nextReviewAt',
    'lastTouchpointAt',
  ];
  const payload = {};
  allowedFields.forEach((field) => {
    if (body[field] !== undefined) {
      payload[field] = body[field];
    }
  });
  if (payload.renewalDate) {
    const parsed = dayjs(payload.renewalDate);
    payload.renewalDate = parsed.isValid() ? parsed.toDate() : null;
  }
  if (payload.nextReviewAt) {
    const parsed = dayjs(payload.nextReviewAt);
    payload.nextReviewAt = parsed.isValid() ? parsed.toDate() : null;
  }
  if (payload.lastTouchpointAt) {
    const parsed = dayjs(payload.lastTouchpointAt);
    payload.lastTouchpointAt = parsed.isValid() ? parsed.toDate() : null;
  }
  return payload;
}

async function loadVendorOr404(id, userId) {
  if (!mongoose.isValidObjectId(id)) {
    throw notFound('Vendor not found');
  }
  const vendor = await ProcurementVendor.findOne({ _id: id, userId });
  if (!vendor) {
    throw notFound('Vendor not found');
  }
  return vendor;
}

function computeStats(vendors) {
  const summary = {
    total: vendors.length,
    active: vendors.filter((v) => v.stage === 'active').length,
    atRisk: vendors.filter((v) => v.riskLevel === 'high' || v.riskLevel === 'critical').length,
    renewalsNextQuarter: vendors.filter((v) => v.renewalDate && dayjs(v.renewalDate).isBefore(dayjs().add(3, 'month'))).length,
    totalAnnualValue: vendors.reduce((acc, v) => acc + Number(v.annualValue || 0), 0),
  };
  return summary;
}

router.use(requireFeature('procurement'));

router.get('/vendors', async (req, res, next) => {
  try {
    const vendors = await ProcurementVendor.find({ userId: req.user.id }).sort({ updatedAt: -1 });
    const stats = computeStats(vendors);
    res.json({ vendors: vendors.map(toPlainVendor), stats });
  } catch (error) {
    next(error);
  }
});

router.post('/vendors', async (req, res, next) => {
  try {
    if (!req.body?.name) {
      throw badRequest('Vendor name is required');
    }
    const payload = extractVendorPayload(req.body);
    const vendor = await ProcurementVendor.create({ ...payload, userId: req.user.id });
    res.status(201).json({ vendor: toPlainVendor(vendor) });
  } catch (error) {
    next(error);
  }
});

router.get('/vendors/:id', async (req, res, next) => {
  try {
    const vendor = await loadVendorOr404(req.params.id, req.user.id);
    res.json({ vendor: toPlainVendor(vendor) });
  } catch (error) {
    next(error);
  }
});

router.patch('/vendors/:id', async (req, res, next) => {
  try {
    const vendor = await loadVendorOr404(req.params.id, req.user.id);
    const payload = extractVendorPayload(req.body || {});
    Object.assign(vendor, payload);
    await vendor.save();
    res.json({ vendor: toPlainVendor(vendor) });
  } catch (error) {
    next(error);
  }
});

router.post('/vendors/:id/objectives', async (req, res, next) => {
  try {
    const vendor = await loadVendorOr404(req.params.id, req.user.id);
    if (!req.body?.title) {
      throw badRequest('Objective title is required');
    }
    vendor.objectives.push({
      title: req.body.title,
      description: req.body.description || '',
      owner: req.body.owner || '',
      metric: req.body.metric || '',
      targetValue: req.body.targetValue || '',
      dueDate: req.body.dueDate ? dayjs(req.body.dueDate).toDate() : null,
      status: req.body.status || 'not_started',
      progress: Number.isFinite(req.body.progress) ? req.body.progress : 0,
      successCriteria: req.body.successCriteria || '',
      dependencies: req.body.dependencies || '',
    });
    await vendor.save();
    res.status(201).json({ vendor: toPlainVendor(vendor) });
  } catch (error) {
    next(error);
  }
});

router.patch('/vendors/:id/objectives/:objectiveId', async (req, res, next) => {
  try {
    const vendor = await loadVendorOr404(req.params.id, req.user.id);
    const objective = vendor.objectives.id(req.params.objectiveId);
    if (!objective) {
      throw notFound('Objective not found');
    }
    Object.assign(objective, {
      description: req.body.description ?? objective.description,
      owner: req.body.owner ?? objective.owner,
      metric: req.body.metric ?? objective.metric,
      targetValue: req.body.targetValue ?? objective.targetValue,
      status: req.body.status ?? objective.status,
      progress: Number.isFinite(req.body.progress) ? req.body.progress : objective.progress,
      successCriteria: req.body.successCriteria ?? objective.successCriteria,
      dependencies: req.body.dependencies ?? objective.dependencies,
      dueDate: req.body.dueDate ? dayjs(req.body.dueDate).toDate() : objective.dueDate,
      lastReviewedAt: new Date(),
    });
    await vendor.save();
    res.json({ vendor: toPlainVendor(vendor) });
  } catch (error) {
    next(error);
  }
});

router.post('/vendors/:id/updates', async (req, res, next) => {
  try {
    const vendor = await loadVendorOr404(req.params.id, req.user.id);
    if (!req.body?.summary) {
      throw badRequest('Update summary is required');
    }
    vendor.updates.unshift({
      summary: req.body.summary,
      actions: Array.isArray(req.body.actions) ? req.body.actions : [],
      category: req.body.category || 'general',
      recordedBy: req.body.recordedBy || '',
      recordedAt: req.body.recordedAt ? dayjs(req.body.recordedAt).toDate() : new Date(),
    });
    vendor.lastTouchpointAt = new Date();
    await vendor.save();
    res.status(201).json({ vendor: toPlainVendor(vendor) });
  } catch (error) {
    next(error);
  }
});

router.post('/vendors/:id/brief', async (req, res, next) => {
  try {
    const vendor = await loadVendorOr404(req.params.id, req.user.id);
    const insights = await generateRelationshipBrief(vendor);
    vendor.relationshipBrief = insights.brief;
    vendor.successPlan = insights.quickWins?.join('\n') || vendor.successPlan;
    await vendor.save();
    res.json({
      vendor: toPlainVendor(vendor),
      recommendations: insights,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
