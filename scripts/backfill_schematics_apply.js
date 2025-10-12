#!/usr/bin/env node
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const pino = require('pino');

const DocumentInsight = require('../backend/models/DocumentInsight');
const { computeBackfillPatch } = require('../backend/src/lib/analyticsV1');

const logger = pino({ name: 'backfill-schematics-apply', level: process.env.LOG_LEVEL ?? 'info' });

function parseArgs(argv) {
  const args = {};
  argv.slice(2).forEach((entry) => {
    if (!entry.startsWith('--')) return;
    const [key, rawValue] = entry.slice(2).split('=');
    const value = rawValue ?? 'true';
    if (key === 'user') args.user = value;
    if (key === 'batch') args.batch = Number(value);
  });
  return args;
}

function buildFilter(args) {
  const filter = {
    'metadata.rulesVersion': { $type: 'string', $ne: null },
    $or: [
      { schemaVersion: { $ne: 'schematic-v1' } },
      { version: { $ne: 'v1' } },
      { 'metadata.extractionSource': { $not: /^schematic@/ } },
      { metricsV1: null },
      { transactionsV1: null },
    ],
  };
  if (args.user) {
    try {
      // eslint-disable-next-line no-underscore-dangle
      filter.userId = new mongoose.Types.ObjectId(args.user);
    } catch (error) {
      throw new Error(`Invalid --user value ${args.user}`);
    }
  }
  return filter;
}

function buildVersionedUpdate(doc) {
  const rulesVersion = doc.metadata?.rulesVersion || 'latest';
  const extractionSource = `schematic@${rulesVersion}`;
  const patch = computeBackfillPatch(doc);
  return {
    ...patch,
    schemaVersion: 'schematic-v1',
    parserVersion: doc.parserVersion?.startsWith('schematic@') ? doc.parserVersion : `schematic@${rulesVersion}`,
    promptVersion: doc.promptVersion?.startsWith('schematic@') ? doc.promptVersion : `schematic@${rulesVersion}`,
    model: doc.model && doc.model.startsWith('schematic') ? doc.model : 'schematic-ingest',
    version: 'v1',
    'metadata.extractionSource': extractionSource,
    'metadata.schematicVersion': rulesVersion,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai_accountant_app';
  await mongoose.connect(mongoUri);

  const filter = buildFilter(args);
  const batchSize = args.batch && Number.isFinite(args.batch) ? Math.max(25, args.batch) : 200;
  const cursor = DocumentInsight.find(filter).lean().cursor();
  const operations = [];
  let scanned = 0;
  let updated = 0;

  // eslint-disable-next-line no-restricted-syntax
  for await (const doc of cursor) {
    scanned += 1;
    const update = buildVersionedUpdate(doc);
    if (!Object.keys(update).length) continue;
    operations.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: update },
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

  logger.info({ scanned, updated }, 'Schematics backfill apply complete');
  await mongoose.disconnect();
}

main().catch((error) => {
  logger.error({ err: error }, 'Schematics backfill apply failed');
  process.exitCode = 1;
});
