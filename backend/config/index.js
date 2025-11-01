'use strict';

const assert = require('assert');

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return String(value).trim();
}

function decodeBase64Key(value, { name, length }) {
  let decoded;
  try {
    decoded = Buffer.from(value, 'base64');
  } catch (err) {
    throw new Error(`${name} must be valid base64 (${err.message})`);
  }
  if (decoded.length !== length) {
    throw new Error(`${name} must decode to ${length} bytes (received ${decoded.length})`);
  }
  return decoded;
}

const config = (() => {
  const r2 = {
    accountId: requireEnv('R2_ACCOUNT_ID'),
    accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
    bucket: requireEnv('R2_BUCKET'),
    endpoint: requireEnv('R2_S3_ENDPOINT'),
  };

  const security = {
    encryptionKey: decodeBase64Key(requireEnv('SEC_ENCRYPTION_KEY'), {
      name: 'SEC_ENCRYPTION_KEY',
      length: 32,
    }),
    hashPepper: requireEnv('SEC_HASH_PEPPER'),
  };

  return Object.freeze({ r2, security });
})();

// Basic runtime assertions so downstream modules can rely on the shape.
assert(config.r2 && typeof config.r2 === 'object', 'Invalid R2 configuration');
assert(config.security && typeof config.security === 'object', 'Invalid security configuration');

module.exports = config;
