const test = require('node:test');
const assert = require('node:assert/strict');

const Module = require('module');
const originalLoad = Module._load;

const jobs = [
  {
    _id: 'job1',
    type: 'persona-briefs',
    status: 'pending',
    attempts: 0,
    payload: { prompt: 'Write something' },
    saveCalls: 0,
    async save() {
      this.saveCalls += 1;
      return this;
    },
  },
  {
    _id: 'job2',
    type: 'exec-narrative',
    status: 'pending',
    attempts: 0,
    payload: { prompt: 'This will fail' },
    saveCalls: 0,
    async save() {
      this.saveCalls += 1;
      return this;
    },
  },
];

Module._load = function patched(request, parent, isMain) {
  if (request === '../models/Job') {
    return {
      findOneAndUpdate: async () => {
        const job = jobs.find((j) => j.status === 'pending');
        if (!job) return null;
        job.status = 'running';
        job.attempts += 1;
        job.workerId = 'test-worker';
        job.lockedAt = new Date();
        return job;
      },
    };
  }
  if (request === '../utils/openai') {
    return {
      generateText: async ({ prompt }) => {
        if (prompt === 'This will fail') {
          throw new Error('bad prompt');
        }
        return { text: `stub:${prompt}`, raw: { ok: true } };
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const worker = require('../services/jobWorker');

Module._load = originalLoad;

test('job worker processes pending job and marks it done', async () => {
  await worker._processNext();
  const job = jobs[0];
  assert.equal(job.status, 'done');
  assert.equal(job.result.text, 'stub:Write something');
  assert.equal(job.saveCalls >= 1, true);
});

test('job worker handles failures by retrying', async () => {
  await worker._processNext();
  const job = jobs[1];
  let guard = 0;
  while (job.status === 'pending' && guard < 5) {
    await worker._processNext();
    guard += 1;
  }
  assert.equal(job.saveCalls >= 1, true);
  assert.equal(job.status === 'error', true);
});
