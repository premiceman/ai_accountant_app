// backend/routes/jobs.js
const express = require('express');
const { Types } = require('mongoose');

const Job = require('../models/Job');
const auth = require('../middleware/auth');
const { validate, requireStringId } = require('../utils/validation');
const { createRateLimiter } = require('../utils/rateLimit');

const router = express.Router();

const limiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: Number(process.env.JOBS_RATE_LIMIT || 10),
});

const ALLOWED_JOB_TYPES = new Set(['persona-briefs', 'exec-narrative']);

router.post(
  '/jobs',
  auth,
  limiter,
  validate((body = {}) => {
    const type = body.type;
    if (!ALLOWED_JOB_TYPES.has(type)) {
      const err = new Error('Invalid job type');
      err.status = 400;
      throw err;
    }
    const payload = (body && typeof body.payload === 'object' && !Array.isArray(body.payload)) ? body.payload : {};
    return { type, payload };
  }),
  async (req, res, next) => {
    try {
      const job = await Job.create({
        type: req.body.type,
        payload: req.body.payload,
        status: 'pending',
        attempts: 0,
      });
      res.status(202).json({ job: serialize(job) });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/jobs/:id',
  auth,
  limiter,
  validate((params = {}) => ({ id: requireStringId(params.id, 'job id') }), 'params'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!Types.ObjectId.isValid(id)) {
        return res.status(400).json({ error: 'Invalid job id' });
      }
      const job = await Job.findById(id);
      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }
      res.json({ job: serialize(job) });
    } catch (err) {
      next(err);
    }
  }
);

function serialize(job) {
  if (!job) return null;
  return {
    id: job._id,
    type: job.type,
    status: job.status,
    payload: job.payload,
    result: job.result,
    attempts: job.attempts,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

module.exports = router;
