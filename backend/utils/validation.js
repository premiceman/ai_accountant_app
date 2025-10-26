// backend/utils/validation.js
function makeError(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function requireStringId(value, field = 'id') {
  if (!value || typeof value !== 'string') {
    throw makeError(`Missing ${field}`);
  }
  return value;
}

function optionalStringArray(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw makeError('Expected an array');
  }
  return value.map((item) => {
    if (typeof item !== 'string') {
      throw makeError('Array must contain strings');
    }
    return item;
  });
}

function optionalBoolean(value) {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw makeError('Expected boolean');
}

function validate(schemaFn, source = 'body') {
  return async (req, res, next) => {
    try {
      const value = await schemaFn(req[source]);
      req[source] = value;
      next();
    } catch (err) {
      const status = err.status || 400;
      res.status(status).json({ error: err.message || 'Validation failed' });
    }
  };
}

module.exports = {
  validate,
  requireStringId,
  optionalStringArray,
  optionalBoolean,
};
