import assert from 'node:assert/strict';

import {
  buildRawInstitutionNamesUpdate,
  ensureSingleOperatorForRawInstitutionNames,
  normalizeRawInstitutionNamesInput,
} from '../lib/rawInstitutionNames.js';
import {
  calculateBackoffDelay,
  determineRetryOutcome,
  DOCUMENT_JOB_MAX_ATTEMPTS,
} from '../documentJobLoop.js';

function testReplaceMode(): void {
  const plan = buildRawInstitutionNamesUpdate('replace', [], ['Alpha', 'Beta']);
  assert.deepEqual(plan.update, { $set: { rawInstitutionNames: ['Alpha', 'Beta'] } });
  assert.equal(plan.summary.mode, 'replace');
  assert.equal(plan.summary.additionsCount, 2);
  assert.equal(plan.applied, true);

  const noChange = buildRawInstitutionNamesUpdate('replace', ['Alpha'], ['Alpha']);
  assert.deepEqual(noChange.update, {});
  assert.equal(noChange.applied, false);
  assert.equal(noChange.summary.mode, 'replace');
}

function testAppendUnique(): void {
  const plan = buildRawInstitutionNamesUpdate('appendUnique', ['Bank'], ['Bank', 'Trust', 'Trust']);
  assert.deepEqual(plan.update, {
    $addToSet: { rawInstitutionNames: { $each: ['Trust'] } },
  });
  assert.deepEqual(plan.summary.operators, ['$addToSet']);
  assert.equal(plan.summary.additionsCount, 1);
  assert.equal(plan.resultingArray.includes('Trust'), true);
}

function testElementUpdate(): void {
  const plan = buildRawInstitutionNamesUpdate(
    'elementUpdate',
    ['Alpha', 'Beta'],
    ['Gamma'],
    { matchValue: 'Beta' }
  );
  assert.deepEqual(plan.update, {
    $set: { 'rawInstitutionNames.$[i]': 'Gamma' },
  });
  assert.equal(plan.summary.arrayFilters, true);
  assert.equal(plan.summary.paths[0], 'rawInstitutionNames.$[i]');
  assert.doesNotThrow(() => ensureSingleOperatorForRawInstitutionNames(plan.update as Record<string, any>));
}

function testGuardRail(): void {
  const conflictingUpdate = {
    $set: { rawInstitutionNames: ['Alpha'] },
    $addToSet: { rawInstitutionNames: { $each: ['Beta'] } },
  };
  assert.throws(() => ensureSingleOperatorForRawInstitutionNames(conflictingUpdate));
}

function testNormalization(): void {
  assert.deepEqual(normalizeRawInstitutionNamesInput(' Bank '), ['Bank']);
  assert.deepEqual(
    normalizeRawInstitutionNamesInput({ a: 'Alpha', b: ' Beta ' }),
    ['Alpha', 'Beta']
  );
  assert.deepEqual(normalizeRawInstitutionNamesInput(null), []);
}

function testBackoffAndDlq(): void {
  const delays = [1, 2, 3, 4].map((attempt) => calculateBackoffDelay(attempt));
  assert.deepEqual(delays, [1000, 2000, 4000, 8000]);
  assert.equal(calculateBackoffDelay(10), 30000);

  for (let attempt = 1; attempt <= DOCUMENT_JOB_MAX_ATTEMPTS; attempt += 1) {
    const outcome = determineRetryOutcome(attempt);
    if (attempt < DOCUMENT_JOB_MAX_ATTEMPTS) {
      assert.equal(outcome.status, 'failed');
      assert.ok(outcome.delayMs > 0);
    } else {
      assert.equal(outcome.status, 'dead_letter');
      assert.equal(outcome.delayMs, 0);
    }
  }
}

function run(): void {
  testReplaceMode();
  testAppendUnique();
  testElementUpdate();
  testGuardRail();
  testNormalization();
  testBackoffAndDlq();
  console.log('All rawInstitutionNames tests passed');
}

run();
