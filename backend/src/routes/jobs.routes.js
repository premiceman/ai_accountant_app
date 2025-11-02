'use strict';

const express = require('express');
const mongoose = require('mongoose');
const auth = require('../../middleware/auth');
const VaultJob = require('../../models/VaultJob');

const router = express.Router();

router.use(auth);

function serializeJob(job) {
  if (!job) return null;
  return {
    id: String(job._id),
    documentId: String(job.documentId),
    status: job.status,
    steps: Array.isArray(job.steps)
      ? job.steps.map((step) => ({
          name: step.name,
          status: step.status,
          startedAt: step.startedAt || null,
          endedAt: step.endedAt || null,
          message: step.message || null,
        }))
      : [],
    error: job.error || null,
    updatedAt: job.updatedAt || job.createdAt || new Date(),
  };
}

async function loadSnapshot(userId) {
  const jobs = await VaultJob.find({ userId }).sort({ updatedAt: -1 }).lean();
  return jobs.map(serializeJob).filter(Boolean);
}

router.get('/stream', async (req, res, next) => {
  try {
    const userId = req?.user?.id;
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const objectId = new mongoose.Types.ObjectId(userId);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    let closed = false;

    const send = (event) => {
      if (closed) return;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const keepAlive = setInterval(() => {
      if (closed) return;
      res.write(': keep-alive\n\n');
    }, 25000);

    const initialJobs = await loadSnapshot(objectId);
    send({ type: 'snapshot', jobs: initialJobs });

    let changeStream;
    let pollingTimer = null;

    const teardown = () => {
      closed = true;
      clearInterval(keepAlive);
      if (changeStream) {
        try {
          changeStream.close();
        } catch (err) {
          // ignore
        }
      }
      if (pollingTimer) {
        clearInterval(pollingTimer);
        pollingTimer = null;
      }
    };

    req.on('close', teardown);
    req.on('error', teardown);

    try {
      changeStream = VaultJob.watch(
        [
          {
            $match: {
              'fullDocument.userId': objectId,
            },
          },
        ],
        { fullDocument: 'updateLookup' }
      );

      changeStream.on('change', (change) => {
        if (closed) return;
        if (!change?.fullDocument) return;
        const job = serializeJob(change.fullDocument);
        if (job) {
          send({ type: 'update', job });
        }
      });

      changeStream.on('error', async () => {
        if (closed) return;
        // fall back to polling
        if (changeStream) {
          try {
            changeStream.close();
          } catch (err) {
            // ignore
          }
        }
        changeStream = null;
        startPolling();
      });
    } catch (err) {
      changeStream = null;
      startPolling();
    }

    function startPolling() {
      if (pollingTimer) return;
      let lastTimestamp = initialJobs[0]?.updatedAt ? new Date(initialJobs[0].updatedAt) : new Date(0);
      pollingTimer = setInterval(async () => {
        if (closed) return;
        try {
          const updates = await VaultJob.find({
            userId: objectId,
            updatedAt: { $gt: lastTimestamp },
          })
            .sort({ updatedAt: 1 })
            .lean();
          if (!updates.length) {
            return;
          }
          lastTimestamp = updates[updates.length - 1].updatedAt;
          updates.forEach((job) => {
            const payload = serializeJob(job);
            if (payload) {
              send({ type: 'update', job: payload });
            }
          });
        } catch (error) {
          // swallow polling errors, next tick will retry
        }
      }, 3000);
    }

    req.on('close', () => {
      if (pollingTimer) {
        clearInterval(pollingTimer);
        pollingTimer = null;
      }
    });
    req.on('error', () => {
      if (pollingTimer) {
        clearInterval(pollingTimer);
        pollingTimer = null;
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
