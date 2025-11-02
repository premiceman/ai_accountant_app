const { provenanceSchema } = require('./provenance');
const { transactionSchema } = require('./transaction.v2');

const statementSchema = {
  $id: 'statement.v2',
  type: 'object',
  additionalProperties: false,
  required: [
    'fileId',
    'contentHash',
    'docType',
    'account',
    'period',
    'transactions',
    'provenance',
  ],
  properties: {
    fileId: { type: 'string', minLength: 1 },
    contentHash: { type: 'string', minLength: 32 },
    docType: { const: 'statement' },
    account: {
      type: 'object',
      required: ['accountId', 'currency'],
      additionalProperties: false,
      properties: {
        accountId: { type: 'string', minLength: 1 },
        name: { type: 'string', minLength: 1 },
        sortCode: { type: 'string', minLength: 1 },
        accountNumber: { type: 'string', minLength: 1 },
        currency: { type: 'string', minLength: 1 },
        provenance: provenanceSchema,
      },
    },
    period: {
      type: 'object',
      required: ['start', 'end'],
      additionalProperties: false,
      properties: {
        start: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        end: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        openingBalance: {
          type: 'object',
          additionalProperties: false,
          required: ['amount', 'currency', 'provenance'],
          properties: {
            amount: { type: 'integer' },
            currency: { type: 'string', minLength: 1 },
            provenance: provenanceSchema,
          },
        },
        closingBalance: {
          type: 'object',
          additionalProperties: false,
          required: ['amount', 'currency', 'provenance'],
          properties: {
            amount: { type: 'integer' },
            currency: { type: 'string', minLength: 1 },
            provenance: provenanceSchema,
          },
        },
      },
    },
    transactions: {
      type: 'array',
      items: transactionSchema,
    },
    provenance: provenanceSchema,
  },
};

module.exports = { statementSchema };
