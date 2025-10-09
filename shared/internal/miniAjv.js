/**
 * ## Intent (Phase-1 only — additive, no breaking changes)
 *
 * Fix inconsistent dashboards by introducing a tiny, normalised v1 data layer alongside
 * today’s legacy fields. Worker dual-writes new normalised shapes, analytics prefers v1 with
 * legacy fallbacks, and Ajv validators warn without breaking existing flows.
 */

class MiniAjv {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_options = {}) {}

  compile(schema) {
    const validator = (data) => {
      const errors = [];
      const valid = validateSchema(schema, data, '', errors);
      validator.errors = valid ? null : errors;
      return valid;
    };
    validator.errors = null;
    return validator;
  }
}

function validateSchema(schema, data, path, errors) {
  if (Array.isArray(schema.type)) {
    const anyValid = schema.type.some((type) => validateSchema({ ...schema, type }, data, path, []));
    if (!anyValid) {
      errors.push({ instancePath: path, message: `should match one of the allowed types ${schema.type.join(', ')}` });
      return false;
    }
    return true;
  }

  switch (schema.type) {
    case 'object':
      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        errors.push({ instancePath: path, message: 'should be an object' });
        return false;
      }
      if (Array.isArray(schema.required)) {
        for (const key of schema.required) {
          if (!(key in data)) {
            errors.push({ instancePath: `${path}/${key}`, message: 'is required' });
          }
        }
      }
      if (schema.properties) {
        for (const [key, childSchema] of Object.entries(schema.properties)) {
          if (key in data) {
            validateSchema(childSchema, data[key], `${path}/${key}`, errors);
          }
        }
      }
      if (schema.additionalProperties === false && schema.properties) {
        for (const key of Object.keys(data)) {
          if (!(key in schema.properties)) {
            errors.push({ instancePath: `${path}/${key}`, message: 'additional property not allowed' });
          }
        }
      }
      return errors.length === 0;
    case 'string':
      if (typeof data !== 'string') {
        errors.push({ instancePath: path, message: 'should be a string' });
        return false;
      }
      if (schema.pattern && !new RegExp(schema.pattern).test(data)) {
        errors.push({ instancePath: path, message: `should match pattern ${schema.pattern}` });
        return false;
      }
      if (typeof schema.maxLength === 'number' && data.length > schema.maxLength) {
        errors.push({ instancePath: path, message: `should NOT be longer than ${schema.maxLength} characters` });
        return false;
      }
      if (schema.enum && !schema.enum.includes(data)) {
        errors.push({ instancePath: path, message: `should be equal to one of the allowed values` });
        return false;
      }
      return true;
    case 'integer':
      if (!Number.isInteger(data)) {
        errors.push({ instancePath: path, message: 'should be an integer' });
        return false;
      }
      return true;
    default:
      return true;
  }
}

module.exports = MiniAjv;
