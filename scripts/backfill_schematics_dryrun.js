#!/usr/bin/env node
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const pino = require('pino');

const DocumentInsight = require('../backend/models/DocumentInsight');
const { computeBackfillPatch } = require('../backend/src/lib/analyticsV1');

const logger = pino({ name: 'backfill-schematics-dryrun', level: process.env.LOG_LEVEL ?? 'info' });

function parseArgs(argv) {
  const args = {};
  argv.slice(2).forEach((entry) => {
    if (!entry.startsWith('--')) return;
    const [key, rawValue] = entry.slice(2).split('=');
    const value = rawValue ?? 'true';
    if (key === 'user') args.user = value;
    if (key === 'limit') args.limit = Number(value);
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

function needsUpgrade(doc) {
  if (!doc.metadata?.rulesVersion) return false;
  if (doc.schemaVersion !== 'schematic-v1') return true;
  if (doc.version !== 'v1') return true;
  if (typeof doc.metadata?.extractionSource !== 'string' || !doc.metadata.extractionSource.startsWith('schematic@'))
    return true;
  if (!doc.metricsV1) return true;
  if (!Array.isArray(doc.transactionsV1)) return true;
  return false;
}

async function main() {
  const args = parseArgs(process.argv);
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai_accountant_app';
  await mongoose.connect(mongoUri);

  const filter = buildFilter(args);
  const cursor = DocumentInsight.find(filter).lean().cursor();
  let scanned = 0;
  let candidates = 0;
  const samples = [];
  const startedAt = Date.now();

  // eslint-disable-next-line no-restricted-syntax
  for await (const doc of cursor) {
    scanned += 1;
    if (!needsUpgrade(doc)) continue;
    candidates += 1;
    if (!args.limit || samples.length < args.limit) {
      const patch = computeBackfillPatch(doc);
      samples.push({
        fileId: doc.fileId,
        userId: doc.userId,
        missing: Object.keys(patch),
        rulesVersion: doc.metadata?.rulesVersion ?? null,
      });
    }
  }

  const durationMs = Date.now() - startedAt;
  logger.info({ scanned, candidates, durationMs }, 'Schematics dry-run complete');
  if (samples.length) {
    logger.info({ examples: samples }, 'Sample candidates');
  }

  await mongoose.disconnect();
}

main().catch((error) => {
  logger.error({ err: error }, 'Schematics dry-run failed');
  process.exitCode = 1;
});
