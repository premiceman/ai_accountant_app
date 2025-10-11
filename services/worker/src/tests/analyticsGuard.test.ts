import assert from 'node:assert/strict';
import { Types } from 'mongoose';

import { rebuildMonthlyAnalytics } from '../services/analytics.js';
import {
  DocumentInsightModel,
  UserAnalyticsModel,
  UserOverrideModel,
} from '../models/index.js';

type RecordedCall = { filter: unknown; update: any };

void (async function run() {
  const userId = new Types.ObjectId();
  const originalFind = DocumentInsightModel.find;
  const originalUpdateOne = DocumentInsightModel.updateOne;
  const originalOverrideFind = UserOverrideModel.find;
  const originalAnalyticsUpdate = UserAnalyticsModel.findOneAndUpdate;

  const analyticsUpdates: RecordedCall[] = [];
  const insightUpdates: RecordedCall[] = [];

  try {
    (DocumentInsightModel.find as any) = () => ({
      lean: () => ({
        exec: async () => [],
      }),
    });

    (UserOverrideModel.find as any) = () => ({
      lean: () => ({
        exec: async () => [],
      }),
    });

    (UserAnalyticsModel.findOneAndUpdate as any) = (filter: unknown, update: any) => ({
      exec: async () => {
        analyticsUpdates.push({ filter, update });
        return null;
      },
    });

    (DocumentInsightModel.updateOne as any) = (filter: unknown, update: any) => ({
      exec: async () => {
        insightUpdates.push({ filter, update });
        return null;
      },
    });

    const baseResult = await rebuildMonthlyAnalytics({
      userId,
      periodMonth: '2024-04',
      fileId: 'doc-success',
    });
    assert.equal(baseResult.status, 'success');
    assert.equal(baseResult.period, '2024-04');
    const latestSuccess = analyticsUpdates[analyticsUpdates.length - 1] as RecordedCall;
    assert.deepEqual(latestSuccess.filter, { userId, period: '2024-04' });
    assert.equal(latestSuccess.update.$set.status, 'success');

    analyticsUpdates.length = 0;
    insightUpdates.length = 0;

    const derivedResult = await rebuildMonthlyAnalytics({
      userId,
      periodMonth: null,
      payDate: '2024-05-15',
      fileId: 'doc-derived',
    });
    assert.equal(derivedResult.status, 'success');
    assert.equal(derivedResult.period, '2024-05');
    const derivedCall = analyticsUpdates[analyticsUpdates.length - 1] as RecordedCall;
    assert.deepEqual(derivedCall.filter, { userId, period: '2024-05' });

    analyticsUpdates.length = 0;
    insightUpdates.length = 0;

    const failedResult = await rebuildMonthlyAnalytics({
      userId,
      periodMonth: null,
      periodYear: null,
      payDate: null,
      fileId: 'doc-failed',
    });
    assert.equal(failedResult.status, 'failed');
    assert.equal(failedResult.reason, 'missing required fields for analytics');
    const failureUpdate = analyticsUpdates[analyticsUpdates.length - 1] as RecordedCall;
    const insightFailure = insightUpdates[insightUpdates.length - 1] as RecordedCall;
    assert.equal(failureUpdate.update.$set.status, 'failed');
    assert.equal(insightFailure.update.$set.status, 'failed');

    console.log('Analytics guard tests passed');
  } catch (error) {
    console.error('Analytics guard tests failed', error);
    process.exitCode = 1;
  } finally {
    (DocumentInsightModel.find as any) = originalFind;
    (DocumentInsightModel.updateOne as any) = originalUpdateOne;
    (UserOverrideModel.find as any) = originalOverrideFind;
    (UserAnalyticsModel.findOneAndUpdate as any) = originalAnalyticsUpdate;
  }
})();
