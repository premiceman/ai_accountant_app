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

(function shouldPrioritiseReviewStep() {
  const response = {
    workflowResponse: {
      standardizeStep: {
        standardizationIds: ['std-initial'],
        standardizationJobIds: ['job-initial'],
      },
      splitStandardizeStep: {
        standardizationIds: ['std-split'],
        standardizationJobIds: ['job-split'],
      },
      standardizeReviewStep: {
        standardizationIds: ['std-final'],
        standardizationJobIds: ['job-final'],
      },
    },
  };

  const candidates = extractStandardizationCandidates(response);
  assert.equal(candidates[0].standardizationId, 'std-final');
  assert.equal(candidates[0].standardizationJobId, 'job-final');
  assert.ok(
    candidates.some(
      (candidate) =>
        candidate.standardizationId === 'std-split' &&
        candidate.standardizationJobId === 'job-split'
    )
  );
  assert.ok(
    candidates.some(
      (candidate) =>
        candidate.standardizationId === 'std-initial' &&
        candidate.standardizationJobId === 'job-initial'
    )
  );
})();

(function shouldMergeDuplicateStandardizationIds() {
  const response = {
    workflowResponse: {
      standardizeReviewStep: {
        standardizationIds: ['std-shared'],
      },
      splitStandardizeStep: {
        standardizationIds: ['std-shared'],
        standardizationJobIds: ['job-shared'],
      },
    },
  };

  const candidates = extractStandardizationCandidates(response);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].standardizationId, 'std-shared');
  assert.equal(candidates[0].standardizationJobId, 'job-shared');
})();

(function shouldIncludeClassifiedCandidates() {
  const response = {
    workflowResponse: {
      standardizeReviewStep: {
        standardizationIds: ['std-primary'],
        standardizationJobIds: ['job-primary'],
      },
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
    },
  };

  const candidates = extractStandardizationCandidates(response);
  const classIds = new Map(
    candidates
      .filter((candidate) => candidate.classKey)
      .map((candidate) => [candidate.classKey, candidate])
  );

  assert.equal(classIds.get('payslip').standardizationJobId, 'job-class-1');
  assert.equal(classIds.get('invoice').standardizationJobId, 'job-class-2');
  assert.equal(classIds.get('payslip').classificationJobId, 'job-classifier');
})();

console.log('docupipe.extractStandardizationCandidates tests passed');
