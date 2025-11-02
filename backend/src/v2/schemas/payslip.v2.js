const { provenanceSchema } = require('./provenance');

const amountSchema = {
  type: 'integer',
};

const payslipSchema = {
  $id: 'payslip.v2',
  type: 'object',
  additionalProperties: false,
  required: [
    'fileId',
    'contentHash',
    'docType',
    'payPeriod',
    'employee',
    'employer',
    'grossPay',
    'netPay',
    'deductions',
    'earnings',
    'provenance',
  ],
  properties: {
    fileId: { type: 'string', minLength: 1 },
    contentHash: { type: 'string', minLength: 32 },
    docType: { const: 'payslip' },
    payPeriod: {
      type: 'object',
      required: ['start', 'end', 'paymentDate'],
      additionalProperties: false,
      properties: {
        start: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        end: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        paymentDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      },
    },
    employee: {
      type: 'object',
      required: ['name'],
      additionalProperties: false,
      properties: {
        name: { type: 'string', minLength: 1 },
        id: { type: 'string', minLength: 1 },
      },
    },
    employer: {
      type: 'object',
      required: ['name'],
      additionalProperties: false,
      properties: {
        name: { type: 'string', minLength: 1 },
        registration: { type: 'string', minLength: 1 },
      },
    },
    grossPay: amountSchema,
    netPay: amountSchema,
    deductions: {
      type: 'object',
      required: ['incomeTax', 'nationalInsurance', 'pension', 'studentLoan', 'otherDeductions'],
      additionalProperties: false,
      properties: {
        incomeTax: amountSchema,
        nationalInsurance: amountSchema,
        pension: amountSchema,
        studentLoan: amountSchema,
        otherDeductions: amountSchema,
      },
    },
    earnings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['label', 'amount', 'provenance'],
        additionalProperties: false,
        properties: {
          label: { type: 'string', minLength: 1 },
          amount: amountSchema,
          provenance: provenanceSchema,
        },
      },
    },
    provenance: {
      type: 'object',
      required: ['fileId', 'page', 'anchor'],
      additionalProperties: false,
      properties: provenanceSchema.properties,
    },
    metadata: {
      type: 'object',
      additionalProperties: false,
      properties: {
        currency: { type: 'string', minLength: 1 },
      },
    },
  },
};

module.exports = { payslipSchema };
