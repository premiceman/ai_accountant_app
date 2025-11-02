const Ajv = require('ajv');

const ajv = new Ajv({
  strict: true,
  allErrors: true,
  removeAdditional: false,
});

function compile(name, schema) {
  return ajv.compile({ $id: name, ...schema });
}

module.exports = { ajv, compile };
