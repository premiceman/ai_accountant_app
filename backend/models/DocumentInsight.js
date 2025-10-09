/**
 * ## Intent (Phase-1 only — additive, no breaking changes)
 *
 * Fix inconsistent dashboards by introducing a tiny, normalised v1 data layer alongside
 * today’s legacy fields. Worker dual-writes new normalised shapes, analytics prefers v1 with
 * legacy fallbacks, and Ajv validators warn without breaking existing flows.
 */

const mongoose = require('mongoose');

const DocumentInsightSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    fileId: { type: String, index: true, required: true },
    catalogueKey: {
      type: String,
      enum: [
        'payslip',
        'current_account_statement',
        'savings_account_statement',
        'isa_statement',
        'investment_statement',
        'pension_statement',
        'hmrc_correspondence',
      ],
      index: true,
      required: true,
    },
    baseKey: { type: String, index: true, required: true },
    schemaVersion: { type: String, required: true },
    parserVersion: { type: String, required: true },
    promptVersion: { type: String, required: true },
    model: { type: String, required: true },
    extractionSource: { type: String, enum: ['openai', 'heuristic'], default: 'openai' },
    confidence: { type: Number, default: null },
    contentHash: { type: String, index: true, required: true },
    documentDate: { type: Date, default: null },
    documentMonth: { type: String, index: true, default: null },
    documentLabel: { type: String, default: null },
    documentName: { type: String, default: null },
    nameMatchesUser: { type: Boolean, default: null },
    collectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'VaultCollection', default: null },
    version: { type: String, default: null },
    currency: { type: String, default: null },
    documentDateV1: { type: String, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    metrics: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    metricsV1: { type: mongoose.Schema.Types.Mixed, default: null },
    transactions: { type: [mongoose.Schema.Types.Mixed], default: () => [] },
    transactionsV1: { type: [mongoose.Schema.Types.Mixed], default: null },
    narrative: { type: [String], default: () => [] },
    extractedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    strict: true,
  }
);

DocumentInsightSchema.index({ userId: 1, catalogueKey: 1 });
DocumentInsightSchema.index({ userId: 1, 'metadata.institutionName': 1 });
DocumentInsightSchema.index({ userId: 1, 'metadata.employerName': 1 });
DocumentInsightSchema.index({ userId: 1, 'metadata.accountId': 1 });
DocumentInsightSchema.index({ userId: 1, documentMonth: 1 });
DocumentInsightSchema.index({ userId: 1, fileId: 1, schemaVersion: 1, contentHash: 1 }, { unique: true });

module.exports = mongoose.model('DocumentInsight', DocumentInsightSchema);

/**
 * Normalise any existing records that still persist documentDate as a string.
 * Without doing this Mongo will order by BSON type before value which causes
 * mixed-type collections to sort incorrectly and miscompute metrics such as
 * `$max`. The script runs once per process boot after a Mongo connection has
 * been established and converts any legacy string values to proper Date
 * instances (invalid strings are nulled out to match historical behaviour).
 */
let documentDateNormalizationScheduled = false;

async function normalizeDocumentDateTypes() {
  const connection = mongoose.connection;
  if (!connection?.db) return;

  const collection = connection.db.collection('documentinsights');
  const cursor = collection.find(
    { documentDate: { $type: 'string' } },
    { projection: { documentDate: 1 } }
  );

  const bulk = [];

  // eslint-disable-next-line no-restricted-syntax
  for await (const doc of cursor) {
    const value = doc.documentDate;
    const parsed = typeof value === 'string' ? new Date(value) : null;
    const isValidDate = parsed instanceof Date && !Number.isNaN(parsed.valueOf());
    bulk.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { documentDate: isValidDate ? parsed : null } },
      },
    });

    if (bulk.length >= 1000) {
      // eslint-disable-next-line no-await-in-loop
      await collection.bulkWrite(bulk, { ordered: false });
      bulk.length = 0;
    }
  }

  if (bulk.length > 0) {
    await collection.bulkWrite(bulk, { ordered: false });
  }
}

function scheduleDocumentDateNormalization() {
  if (documentDateNormalizationScheduled) return;
  documentDateNormalizationScheduled = true;

  const run = () => {
    normalizeDocumentDateTypes().catch((err) => {
      console.error('Failed to normalise DocumentInsight documentDate fields', err);
    });
  };

  if (mongoose.connection.readyState >= 1) {
    run();
  } else {
    mongoose.connection.once('connected', run);
  }
}

scheduleDocumentDateNormalization();
