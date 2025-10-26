// backend/services/jobWorker.js
const os = require('os');

const Job = require('../models/Job');
const { generateText } = require('../utils/openai');

const WORKER_ID = `${os.hostname()}-${process.pid}`;
const POLL_INTERVAL_MS = Number(process.env.JOB_WORKER_INTERVAL_MS || 10_000);
const MAX_ATTEMPTS = Number(process.env.JOB_WORKER_MAX_ATTEMPTS || 3);
let timer = null;
let running = false;

async function runJob(job) {
  if (job.type === 'persona-briefs') {
    const prompt = job.payload?.prompt || 'Generate a concise persona brief.';
    const result = await generateText({
      system: 'You create structured persona briefs for financial workflows.',
      prompt,
    });
    return { text: result.text, raw: result.raw };
  }

  if (job.type === 'exec-narrative') {
    const prompt = job.payload?.prompt || 'Draft an executive narrative summarising project impact.';
    const result = await generateText({
      system: 'You are an executive assistant who crafts strategic narratives.',
      prompt,
    });
    return { text: result.text, raw: result.raw };
  }

  throw new Error(`Unsupported job type: ${job.type}`);
}

async function processNext() {
  if (running) return;
  running = true;
  try {
    const job = await Job.findOneAndUpdate(
      { status: 'pending' },
      { status: 'running', workerId: WORKER_ID, lockedAt: new Date(), $inc: { attempts: 1 } },
      { sort: { createdAt: 1 }, new: true }
    );
    if (!job) return;

    try {
      const result = await runJob(job);
      job.status = 'done';
      job.result = result;
      job.error = null;
      await job.save();
    } catch (err) {
      job.error = err.message || 'Job failed';
      if (job.attempts >= MAX_ATTEMPTS) {
        job.status = 'error';
      } else {
        job.status = 'pending';
      }
      await job.save();
    }
  } catch (err) {
    console.error('Job worker error:', err);
  } finally {
    running = false;
  }
}

function start() {
  if (timer || process.env.RUN_WORKER !== 'true') {
    return;
  }
  timer = setInterval(processNext, POLL_INTERVAL_MS);
  timer.unref?.();
}

module.exports = {
  start,
  _processNext: processNext,
};
