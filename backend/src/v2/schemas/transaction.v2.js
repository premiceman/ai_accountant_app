const { provenanceSchema } = require('./provenance');

const transactionSchema = {
  $id: 'transaction.v2',
  type: 'object',
  additionalProperties: false,
  required: [
    'transactionId',
    'fileId',
    'contentHash',
    'date',
    'amount',
    'currency',
    'description',
    'accountId',
    'provenance',
  ],
  properties: {
    transactionId: { type: 'string', minLength: 1 },
    fileId: { type: 'string', minLength: 1 },
    contentHash: { type: 'string', minLength: 32 },
    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    amount: { type: 'integer' },
    currency: { type: 'string', minLength: 1 },
    description: { type: 'string', minLength: 1 },
    category: { type: 'string', minLength: 1 },
    subcategory: { type: 'string', minLength: 1 },
    accountId: { type: 'string', minLength: 1 },
    counterparty: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', minLength: 1 },
        iban: { type: 'string', minLength: 1 },
      },
    },
    provenance: provenanceSchema,
    balance: {
      type: 'object',
      additionalProperties: false,
      properties: {
        amount: { type: 'integer' },
        currency: { type: 'string', minLength: 1 },
      },
    },
  },
};

module.exports = { transactionSchema };
