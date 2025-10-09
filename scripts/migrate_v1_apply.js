// NOTE: Phase-2 — backfill v1 & add /api/analytics/v1/* endpoints. Legacy endpoints unchanged.
#!/usr/bin/env node
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const pino = require('pino');

const DocumentInsight = require('../backend/models/DocumentInsight');
const { computeBackfillPatch } = require('../backend/src/lib/analyticsV1');

const logger = pino({ name: 'migrate-v1-apply', level: process.env.LOG_LEVEL ?? 'info' });

function parseArgs(argv) {
  const args = {};
  for (const entry of argv.slice(2)) {
    if (!entry.startsWith('--')) continue;
    const [key, rawValue] = entry.slice(2).split('=');
    const value = rawValue ?? 'true';
    if (key === 'user') args.user = value;
    if (key === 'from') args.from = value;
    if (key === 'to') args.to = value;
    if (key === 'batch') args.batch = Number(value);
  }
  return args;
}

function buildRangeFilter(args) {
  const filter = {};
  if (args.user) {
    try {
      filter.userId = new mongoose.Types.ObjectId(args.user);
    } catch (error) {
      throw new Error(`Invalid --user value ${args.user}`);
    }
  }
  if (args.from || args.to) {
    const from = args.from ?? args.to;
    const to = args.to ?? args.from;
    const range = {};
    if (from) range.$gte = `${from}`;
    if (to) range.$lte = `${to}`;
    filter.documentMonth = range;
  }
  return filter;
}

function needsBackfill(doc) {
  if (doc.version !== 'v1') return true;
  if (!doc.documentMonth) return true;
  if (!doc.metricsV1) return true;
  if (!Array.isArray(doc.transactionsV1)) return true;
  if (!doc.documentDateV1) return true;
  return false;
}

async function main() {
  const args = parseArgs(process.argv);
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai_accountant_app';
  await mongoose.connect(mongoUri);

  const filter = { ...buildRangeFilter(args), $or: [
    { version: { $ne: 'v1' } },
    { documentMonth: { $in: [null, ''] } },
    { metricsV1: null },
    { transactionsV1: null },
    { documentDateV1: null },
  ] };

  const cursor = DocumentInsight.find(filter).lean().cursor();
  const batchSize = args.batch && Number.isFinite(args.batch) ? Math.max(10, args.batch) : 200;
  const operations = [];
  let scanned = 0;
  let updated = 0;

  // eslint-disable-next-line no-restricted-syntax
  for await (const doc of cursor) {
    scanned += 1;
    if (!needsBackfill(doc)) continue;
    const patch = computeBackfillPatch(doc);
    if (!Object.keys(patch).length) continue;
    operations.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: patch },
      },
    });
    if (operations.length >= batchSize) {
      // eslint-disable-next-line no-await-in-loop
      const result = await DocumentInsight.bulkWrite(operations, { ordered: false });
      const modified = result.modifiedCount ?? result.nModified ?? 0;
      updated += modified;
      operations.length = 0;
    }
  }

  if (operations.length) {
    const result = await DocumentInsight.bulkWrite(operations, { ordered: false });
    const modified = result.modifiedCount ?? result.nModified ?? 0;
    updated += modified;
  }

  logger.info({ scanned, updated }, 'Backfill apply complete');
  await mongoose.disconnect();
}

main().catch((error) => {
  logger.error({ err: error }, 'Backfill apply failed');
  process.exitCode = 1;
});
