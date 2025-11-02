const provenanceSchema = {
  type: 'object',
  required: ['fileId', 'page', 'anchor'],
  additionalProperties: false,
  properties: {
    fileId: { type: 'string', minLength: 1 },
    page: { type: 'integer', minimum: 1 },
    anchor: { type: 'string', minLength: 1 },
  },
};

module.exports = { provenanceSchema };
