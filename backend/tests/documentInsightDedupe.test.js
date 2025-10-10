const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('module');

const stubPath = path.resolve(__dirname, '__mongooseStub.js');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(request, parent, isMain, options) {
  if (request === 'mongoose') {
    return stubPath;
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

const mongoose = require('mongoose');

const modelPath = path.resolve(__dirname, '../models/DocumentInsight.js');

async function run() {
  const originalConnection = mongoose.connection;
  const operations = {
    updateMany: null,
    dropIndex: null,
    aggregateCalled: 0,
    deleteMany: null,
  };

  const collectionStub = {
    async updateMany(filter, pipeline) {
      operations.updateMany = { filter, pipeline };
    },
    async dropIndex(name) {
      operations.dropIndex = name;
    },
    aggregate() {
      operations.aggregateCalled += 1;
      return {
        async toArray() {
          return [
            {
              docs: [
                { _id: 'newest', updatedAt: new Date('2024-05-02') },
                { _id: 'older', updatedAt: new Date('2024-04-01') },
              ],
            },
          ];
        },
      };
    },
    async deleteMany(filter) {
      operations.deleteMany = filter;
    },
  };

  const connectionStub = {
    readyState: 0,
    once(event, handler) {
      if (event === 'connected') {
        this._handler = handler;
      }
    },
    get db() {
      return { collection: () => collectionStub };
    },
  };

  mongoose.connection = connectionStub;
  delete require.cache[modelPath];
  const DocumentInsight = require(modelPath);
  const dedupe = DocumentInsight.__private__?.dedupeLegacyDocumentInsights
    || DocumentInsight.dedupeLegacyDocumentInsights;

  await dedupe();

  assert(operations.updateMany, 'expected updateMany to be called');
  assert.deepEqual(operations.updateMany.filter, {
    $or: [{ insightType: { $exists: false } }, { insightType: null }],
  });
  assert.equal(Array.isArray(operations.updateMany.pipeline), true);
  assert(operations.updateMany.pipeline[0].$set, 'pipeline should include $set stage');
  assert.equal(operations.dropIndex, 'userId_1_fileId_1_schemaVersion_1_contentHash_1');
  assert.deepEqual(operations.deleteMany, { _id: { $in: ['older'] } });

  mongoose.connection = originalConnection;
  Module._resolveFilename = originalResolve;
  delete require.cache[stubPath];
  console.log('DocumentInsight dedupe test passed');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
