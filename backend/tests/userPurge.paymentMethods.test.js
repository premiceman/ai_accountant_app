const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const originalLoad = Module._load;

const fakeUser = { _id: 'user-123', email: 'user@example.com' };
let paymentMethods = [
  { _id: 'pm-1', userId: fakeUser._id },
  { _id: 'pm-2', userId: fakeUser._id },
  { _id: 'pm-3', userId: 'someone-else' },
];

function stringId(value) {
  return value && typeof value === 'object' && value.toString ? value.toString() : String(value);
}

Module._load = function patchedLoader(request, parent, isMain) {
  if (request.startsWith('../../models/')) {
    const name = request.split('/').pop();
    if (name === 'PaymentMethod') {
      return {
        deleteMany: async (filter = {}) => {
          const userId = stringId(filter.userId);
          const before = paymentMethods.length;
          paymentMethods = paymentMethods.filter((method) => stringId(method.userId) !== userId);
          return { deletedCount: before - paymentMethods.length };
        },
      };
    }
    if (name === 'User') {
      return {
        async findById() {
          return fakeUser;
        },
        async findByIdAndUpdate() {
          return fakeUser;
        },
        async deleteOne() {
          return { deletedCount: 1 };
        },
      };
    }
    return {
      deleteMany: async () => ({ deletedCount: 0 }),
    };
  }

  if (request === '../../src/utils/r2') {
    return { s3: null, BUCKET: 'test-bucket', listAll: async () => [] };
  }

  if (request === '@workos-inc/node') {
    return { WorkOS: class { constructor() {} } };
  }

  return originalLoad.call(this, request, parent, isMain);
};

const { purgeUserData } = require('../services/user/purge');

Module._load = originalLoad;

test('purgeUserData removes payment methods for the user', async () => {
  const result = await purgeUserData(fakeUser._id, { preserveProfile: true, existingUser: fakeUser });

  assert.equal(result.ok, true);
  assert.equal(result.mongo.paymentMethods, 2);
  assert.equal(paymentMethods.filter((method) => stringId(method.userId) === stringId(fakeUser._id)).length, 0);
});
