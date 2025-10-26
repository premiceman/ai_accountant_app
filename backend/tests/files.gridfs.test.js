const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('stream');

const Module = require('module');
const originalLoad = Module._load;

const fakeObjectId = () => Math.random().toString(16).slice(2) + Date.now().toString(16);

const mongooseStub = {
  Types: {
    ObjectId: class ObjectId {
      constructor(value) {
        this.value = value || fakeObjectId();
      }
      toString() {
        return this.value;
      }
      static isValid(v) {
        return typeof v === 'string' && v.length > 0;
      }
    }
  }
};

const bucketFiles = new Map();

Module._load = function patched(request, parent, isMain) {
  if (request === 'mongoose') {
    return mongooseStub;
  }
  if (request === 'express') {
    return {
      Router() {
        const stack = [];
        const router = function router() {};
        router.stack = stack;
        const register = (method, path, handlers) => {
          stack.push({
            route: {
              path,
              methods: { [method]: true },
              stack: handlers.map((fn) => ({ handle: fn })),
            },
          });
        };
        router.post = (path, ...handlers) => { register('post', path, handlers); return router; };
        router.get = (path, ...handlers) => { register('get', path, handlers); return router; };
        router.use = () => router;
        return router;
      },
    };
  }
  if (request === 'express-rate-limit') {
    return () => (_req, _res, next) => next();
  }
  if (request === '../models/Project') {
    return {
      findById: async () => ({ _id: 'proj1', ownerId: 'user123' }),
    };
  }
  if (request === '../models/File') {
    return {
      async create(doc) {
        bucketFiles.set('meta', doc);
        return { ...doc, _id: 'fileMetaId', createdAt: new Date(), updatedAt: new Date() };
      },
      find: async () => [],
      findById: async () => null,
    };
  }
  if (request === '../utils/gridfs') {
    return {
      ensureBucket: () => ({
        openUploadStream(filename, opts) {
          const stream = new PassThrough();
          stream.id = fakeObjectId();
          const chunks = [];
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('finish', () => {
            const buffer = Buffer.concat(chunks);
            bucketFiles.set(stream.id, {
              _id: stream.id,
              filename,
              chunkSize: buffer.length,
              length: buffer.length,
              uploadDate: new Date(),
              md5: 'stub-md5',
              contentType: opts.contentType,
            });
          });
          return stream;
        },
        find(query) {
          return {
            next: async () => bucketFiles.get(query._id),
          };
        },
      }),
    };
  }
  if (request === '../utils/rateLimit') {
    return { createRateLimiter: () => (_req, _res, next) => next() };
  }
  if (request === 'multer') {
    const fn = () => ({ single: () => (req, _res, next) => next() });
    fn.memoryStorage = () => ({ });
    return fn;
  }
  if (request === '../models/User') {
    return { findById: async () => ({ roles: ['admin'] }) };
  }
  if (request === '../models/AuditLog') {
    return { create: async () => {} };
  }
  if (request === 'jsonwebtoken') {
    return { sign: () => 'token', verify: () => ({ id: 'user123' }) };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const router = require('../routes/files');

Module._load = originalLoad;

function findRoute(method, path) {
  for (const layer of router.stack) {
    if (!layer.route) continue;
    if (layer.route.path === path && layer.route.methods[method]) {
      return layer.route.stack[layer.route.stack.length - 1].handle;
    }
  }
  throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
}

test('rejects oversized uploads', async () => {
  const handler = findRoute('post', '/projects/:id/files');
  let statusCode;
  let payload;
  const req = {
    params: { id: 'project1' },
    user: { id: 'user123' },
    file: { originalname: 'big.pdf', mimetype: 'application/pdf', size: 20 * 1024 * 1024, buffer: Buffer.alloc(10) },
  };
  const res = {
    status(code) { statusCode = code; return this; },
    json(data) { payload = data; return this; }
  };
  await handler(req, res, () => {});
  assert.equal(statusCode, 400);
  assert.equal(payload.error, 'File too large');
});

test('persists metadata on successful upload', async () => {
  const handler = findRoute('post', '/projects/:id/files');
  const req = {
    params: { id: 'project1' },
    user: { id: 'user123' },
    file: { originalname: 'ok.pdf', mimetype: 'application/pdf', size: 10, buffer: Buffer.from('hello') },
  };
  let jsonResponse;
  const res = {
    status(code) { this.statusCode = code; return this; },
    json(data) { jsonResponse = data; return this; }
  };
  await handler(req, res, (err) => { if (err) throw err; });
  assert.equal(res.statusCode, 201);
  assert.ok(jsonResponse.file);
  assert.equal(bucketFiles.get('meta').filename, 'ok.pdf');
});
