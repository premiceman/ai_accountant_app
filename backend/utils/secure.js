// backend/utils/secure.js
const crypto = require('crypto');

const keySource = process.env.PLAID_ENCRYPTION_KEY || process.env.JWT_SECRET || '';
let key = null;

if (keySource) {
  key = crypto.createHash('sha256').update(String(keySource)).digest();
} else {
  console.warn('⚠️  PLAID_ENCRYPTION_KEY not set; Plaid access tokens will be stored without encryption.');
}

function encrypt(text) {
  if (!text) return null;
  if (!key) {
    return { plain: true, data: String(text) };
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    data: enc.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    plain: false,
  };
}

function decrypt(payload) {
  if (!payload) return null;
  if (payload.plain || !key) {
    return payload.data || null;
  }
  const iv = Buffer.from(payload.iv, 'base64');
  const data = Buffer.from(payload.data, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString('utf8');
}

module.exports = { encrypt, decrypt };
