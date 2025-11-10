const assert = require('node:assert/strict');

process.env.DOCUPIPE_BASE_URL = process.env.DOCUPIPE_BASE_URL || 'https://docupipe.example.com';
process.env.DOCUPIPE_WORKFLOW_ID = process.env.DOCUPIPE_WORKFLOW_ID || 'wf-test';
process.env.DOCUPIPE_API_KEY = process.env.DOCUPIPE_API_KEY || 'test-api-key';
process.env.PAYSLIP_SCHEMA_ID = process.env.PAYSLIP_SCHEMA_ID || 'schema-payslip';
process.env.BANK_STATEMENT_SCHEMA_ID = process.env.BANK_STATEMENT_SCHEMA_ID || 'schema-bank';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost/test';
process.env.R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || 'test-account';
process.env.R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || 'test-access-key';
process.env.R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || 'test-secret';
process.env.R2_BUCKET = process.env.R2_BUCKET || 'test-bucket';
process.env.R2_S3_ENDPOINT = process.env.R2_S3_ENDPOINT || 'https://r2.example.com';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-openai-key';

const {
  extractStandardizationCandidates,
} = require('../src/v2/services/docupipe');

(function shouldPrioritiseClassifyStep() {
  const response = {
    workflowResponse: {
      classifyStandardizeStep: {
        classToStandardizationIds: {
          payslip: 'std-class-1',
          invoice: 'std-class-2',
        },
        classToStandardizationJobIds: {
          payslip: 'job-class-1',
          invoice: 'job-class-2',
        },
        classificationJobId: 'job-classifier',
      },
      standardizeStep: {
        standardizationIds: ['std-fallback'],
        standardizationJobIds: ['job-fallback'],
      },
    },
  };

  const candidates = extractStandardizationCandidates(response);
  assert.equal(candidates[0].source, 'classifyStandardizeStep');
  assert.equal(candidates[0].standardizationJobId, 'job-class-1');
  assert.equal(candidates[0].classificationJobId, 'job-classifier');
  assert.equal(candidates[1].standardizationJobId, 'job-class-2');
  assert.ok(
    candidates.some(
      (candidate) =>
        candidate.standardizationId === 'std-fallback' &&
        candidate.standardizationJobId === 'job-fallback'
    )
  );
})();

(function shouldFallbackToStandardizeStep() {
  const response = {
    workflowResponse: {
      standardizeStep: {
        standardizationIds: ['std-only'],
        standardizationJobIds: ['job-only'],
      },
    },
  };

  const candidates = extractStandardizationCandidates(response);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].standardizationId, 'std-only');
  assert.equal(candidates[0].standardizationJobId, 'job-only');
})();

(function shouldDeduplicateByJobAndId() {
  const response = {
    workflowResponse: {
      classifyStandardizeStep: {
        classToStandardizationIds: { payslip: 'std-dup' },
        classToStandardizationJobIds: { payslip: 'job-dup' },
      },
      anotherStep: {
        standardizationIds: ['std-dup'],
        standardizationJobIds: ['job-dup'],
      },
    },
  };

  const candidates = extractStandardizationCandidates(response);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].standardizationId, 'std-dup');
  assert.equal(candidates[0].standardizationJobId, 'job-dup');
})();

console.log('docupipe.extractStandardizationCandidates tests passed');
