const { createHash } = require('crypto');

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

module.exports = { sha256 };
