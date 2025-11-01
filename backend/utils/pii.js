'use strict';

const crypto = require('crypto');
const { security } = require('../config');

const BULLET = '\u2022';

function maskAccount(value) {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  if (!digits) return '';
  const last4 = digits.slice(-4);
  const maskedLength = Math.max(0, digits.length - last4.length);
  return `${BULLET.repeat(maskedLength)}${last4}`;
}

function maskNI(value) {
  const str = String(value || '').trim();
  if (!str) return '';
  if (str.length <= 3) return BULLET.repeat(str.length);
  const tail = str.slice(-3);
  return `${BULLET.repeat(str.length - 3)}${tail}`;
}

function hashPII(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  return crypto.createHash('sha256').update(normalized + security.hashPepper).digest('hex');
}

module.exports = {
  maskAccount,
  maskNI,
  hashPII,
};
