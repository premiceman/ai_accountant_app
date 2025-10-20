// backend/services/user/purge.js
const Account = require('../../models/Account');
const DocumentInsight = require('../../models/DocumentInsight');
const Event = require('../../models/Event');
const PlaidItem = require('../../models/PlaidItem');
const Transaction = require('../../models/Transaction');
const UploadSession = require('../../models/UploadSession');
const User = require('../../models/User');
const UserAnalytics = require('../../models/UserAnalytics');
const UserDocumentJob = require('../../models/UserDocumentJob');
const UserOverride = require('../../models/UserOverride');
const VaultCollection = require('../../models/VaultCollection');
const VaultFile = require('../../models/VaultFile');
const PaymentMethod = require('../../models/PaymentMethod');
const Subscription = require('../../models/Subscription');

let WorkOS = null;
let workosClient = null;
try {
  ({ WorkOS } = require('@workos-inc/node'));
  const key = process.env.WORKOS_API_KEY || process.env.WORKOS_KEY || '';
  if (WorkOS && key) {
    workosClient = new WorkOS(key);
  }
} catch (err) {
  WorkOS = null;
  workosClient = null;
  console.warn('⚠️  WorkOS SDK unavailable – account deletions will skip identity provider cleanup.');
}

const { s3, BUCKET, listAll } = (() => {
  try {
    return require('../../src/utils/r2');
  } catch (err) {
    console.warn('⚠️  R2 utilities unavailable – data purge will skip object storage cleanup.');
    return { s3: null, BUCKET: null, listAll: null };
  }
})();
let DeleteObjectsCommand = null;
try {
  ({ DeleteObjectsCommand } = require('@aws-sdk/client-s3'));
} catch (err) {
  DeleteObjectsCommand = null;
}

const INTEGRATION_SEEDS = [
  { key: 'hmrc', label: 'HMRC Portal' },
  { key: 'truelayer', label: 'TrueLayer' },
  { key: 'companies', label: 'Companies House' },
  { key: 'quickbooks', label: 'QuickBooks' },
  { key: 'xero', label: 'Xero' },
];

function seedIntegrations(existing = []) {
  const byKey = new Map((existing || []).map((entry) => [entry?.key, entry]));
  return INTEGRATION_SEEDS.map((seed) => ({
    ...seed,
    status: byKey.get(seed.key)?.status || 'not_connected',
    lastCheckedAt: byKey.get(seed.key)?.lastCheckedAt || null,
    metadata: byKey.get(seed.key)?.metadata || {},
  }));
}

function defaultUsageStats() {
  return {
    documentsUploaded: 0,
    documentsRequiredMet: 0,
    documentsHelpfulMet: 0,
    documentsAnalyticsMet: 0,
    documentsRequiredCompleted: 0,
    documentsHelpfulCompleted: 0,
    documentsAnalyticsCompleted: 0,
    documentsRequiredTotal: 0,
    documentsHelpfulTotal: 0,
    documentsAnalyticsTotal: 0,
    documentsProgressUpdatedAt: null,
    documentsCatalogue: {},
    moneySavedEstimate: 0,
    moneySavedPrevSpend: 0,
    moneySavedChangePct: 0,
    moneySavedCumulative: 0,
    hmrcFilingsComplete: 0,
    minutesActive: 0,
    usageWindowDays: 0,
    netCashPrev: 0,
  };
}

function defaultOnboarding() {
  return {
    wizardCompletedAt: null,
    tourCompletedAt: null,
    goals: [],
    lastPromptedAt: null,
    mandatoryCompletedAt: null,
  };
}

function defaultOnboardingSurvey() {
  return {
    interests: [],
    motivations: [],
    valueSignals: [],
    tierSignals: [],
    recommendedTier: null,
    recommendedSummary: '',
    planChoice: {},
    completedAt: null,
  };
}

function defaultSalaryNavigator() {
  return {
    targetSalary: null,
    currentSalary: null,
    nextReviewAt: null,
    role: '',
    company: '',
    location: '',
    tenure: null,
    package: {
      base: 0,
      bonus: 0,
      commission: 0,
      equity: 0,
      benefits: 0,
      other: 0,
      notes: '',
    },
    contractFileId: null,
    contractFile: {
      id: null,
      name: null,
      viewUrl: null,
      downloadUrl: null,
      collectionId: null,
      linkedAt: null,
    },
    benefits: {},
    achievements: [],
    promotionCriteria: [],
    benchmarks: [],
    marketBenchmark: {},
    taxSummary: {},
  };
}

function defaultWealthPlan() {
  return {
    goals: [],
    assets: [],
    liabilities: [],
    contributions: { monthly: 0 },
    strategy: {},
    summary: {},
    lastComputed: null,
  };
}

function stripDiacritics(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}

function formatNamePart(part) {
  const cleaned = stripDiacritics(part).replace(/[^a-zA-Z0-9]+/g, '');
  if (!cleaned) return '';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function sanitizeUniquePart(part, fallback) {
  const raw = stripDiacritics(part || fallback || '');
  const cleaned = raw.replace(/[^a-zA-Z0-9]+/g, '');
  return cleaned || fallback || '';
}

function fallbackUniqueFromId(userId) {
  const id = String(userId || '').replace(/[^a-f0-9]/gi, '');
  if (!id) return `User${String(userId || 'Unknown')}`;
  return `User${id.slice(-8)}`;
}

function buildAccountStorageSlug(userDoc, userId) {
  if (!userDoc) return fallbackUniqueFromId(userId);
  const first = formatNamePart(userDoc.firstName);
  const last = formatNamePart(userDoc.lastName);
  const unique = sanitizeUniquePart(userDoc.uid, fallbackUniqueFromId(userId));
  const slug = `${first}${last}${unique}`.trim();
  return slug || fallbackUniqueFromId(userId);
}

async function deleteR2NamespaceForUser(userDoc) {
  if (!userDoc || !s3 || !BUCKET || typeof listAll !== 'function' || !DeleteObjectsCommand) {
    return { attempted: false, deleted: 0 };
  }

  const slug = buildAccountStorageSlug(userDoc, userDoc._id);
  const prefix = `${slug}/`;
  try {
    const objects = await listAll(prefix);
    if (!Array.isArray(objects) || !objects.length) {
      return { attempted: true, deleted: 0 };
    }
    let deleted = 0;
    for (let i = 0; i < objects.length; i += 1000) {
      const chunk = objects.slice(i, i + 1000).map((obj) => ({ Key: obj.Key }));
      if (!chunk.length) continue;
      // eslint-disable-next-line no-await-in-loop
      await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: chunk } }));
      deleted += chunk.length;
    }
    return { attempted: true, deleted };
  } catch (err) {
    console.error('Failed to delete R2 objects for user', { userId: String(userDoc?._id || ''), error: err });
    return { attempted: true, deleted: 0, error: err?.message || 'unknown_error' };
  }
}

async function deleteWorkOSUser(email) {
  if (!workosClient || !email) {
    return { attempted: false };
  }
  try {
    const list = await workosClient.userManagement.listUsers({ email });
    const candidates = Array.isArray(list?.data)
      ? list.data
      : Array.isArray(list?.users)
        ? list.users
        : [];
    const target = candidates.find((item) => String(item?.email || '').toLowerCase() === String(email).toLowerCase());
    if (!target) {
      return { attempted: true, deleted: false, reason: 'not_found' };
    }
    await workosClient.userManagement.deleteUser(target.id);
    return { attempted: true, deleted: true, userId: target.id };
  } catch (err) {
    console.error('Failed to delete WorkOS user', { email, error: err });
    return { attempted: true, deleted: false, error: err?.message || 'unknown_error' };
  }
}

async function resetUserProfile(userDoc) {
  if (!userDoc) return { updated: false };
  const update = {
    profileInterests: [],
    usageStats: defaultUsageStats(),
    onboarding: defaultOnboarding(),
    onboardingSurvey: defaultOnboardingSurvey(),
    onboardingComplete: false,
    integrations: seedIntegrations(),
    integrationSessions: [],
    documentInsights: {},
    salaryNavigator: defaultSalaryNavigator(),
    wealthPlan: defaultWealthPlan(),
  };
  try {
    await User.findByIdAndUpdate(userDoc._id, { $set: update });
    return { updated: true };
  } catch (err) {
    console.error('Failed to reset user profile during purge', { userId: String(userDoc._id), error: err });
    return { updated: false, error: err?.message || 'unknown_error' };
  }
}

async function purgeCollections(userId) {
  const mongo = {};
  async function remove(label, action) {
    try {
      const res = await action();
      mongo[label] = res?.deletedCount ?? 0;
      delete mongo[`${label}Error`];
    } catch (err) {
      console.error(`Failed to delete ${label} for user`, { userId: String(userId), error: err });
      mongo[label] = 0;
      mongo[`${label}Error`] = err?.message || 'unknown_error';
    }
  }

  await remove('accounts', () => Account.deleteMany({ userId }));
  await remove('documentInsights', () => DocumentInsight.deleteMany({ userId }));
  await remove('events', () => Event.deleteMany({ userId: String(userId) }));
  await remove('plaidItems', () => PlaidItem.deleteMany({ userId }));
  await remove('transactions', () => Transaction.deleteMany({ userId }));
  await remove('uploadSessions', () => UploadSession.deleteMany({ userId }));
  await remove('userAnalytics', () => UserAnalytics.deleteMany({ userId }));
  await remove('userDocumentJobs', () => UserDocumentJob.deleteMany({ userId }));
  await remove('userOverrides', () => UserOverride.deleteMany({ userId }));
  await remove('vaultCollections', () => VaultCollection.deleteMany({ userId }));
  await remove('vaultFiles', () => VaultFile.deleteMany({ userId }));
  await remove('paymentMethods', () => PaymentMethod.deleteMany({ userId }));

  return mongo;
}

async function purgeUserData(userId, { preserveProfile = true, existingUser = null } = {}) {
  const userDoc = existingUser || await User.findById(userId);
  if (!userDoc) {
    return { ok: false, reason: 'user_not_found' };
  }

  const mongo = await purgeCollections(userDoc._id);
  const r2 = await deleteR2NamespaceForUser(userDoc);
  const profileReset = preserveProfile ? await resetUserProfile(userDoc) : { skipped: true };

  return {
    ok: true,
    userId: String(userDoc._id),
    mongo,
    r2,
    profileReset,
  };
}

async function deleteUserAccount(userIdOrDoc) {
  const existingUser = typeof userIdOrDoc === 'object' && userIdOrDoc !== null
    ? userIdOrDoc
    : await User.findById(userIdOrDoc);
  if (!existingUser) {
    return { ok: false, reason: 'user_not_found' };
  }

  const purge = await purgeUserData(existingUser._id, { preserveProfile: false, existingUser });

  const mongo = { ...purge.mongo };
  async function remove(label, action) {
    try {
      const res = await action();
      mongo[label] = res?.deletedCount ?? 0;
      delete mongo[`${label}Error`];
    } catch (err) {
      console.error(`Failed to delete ${label} for user`, { userId: String(existingUser._id), error: err });
      mongo[label] = 0;
      mongo[`${label}Error`] = err?.message || 'unknown_error';
    }
  }

  const hasPaymentMethodCount = Object.prototype.hasOwnProperty.call(mongo, 'paymentMethods');
  const hasPaymentMethodError = Object.prototype.hasOwnProperty.call(mongo, 'paymentMethodsError');
  if (!hasPaymentMethodCount || hasPaymentMethodError) {
    await remove('paymentMethods', () => PaymentMethod.deleteMany({ userId: existingUser._id }));
  }
  await remove('subscriptions', () => Subscription.deleteMany({ userId: existingUser._id }));

  let removedUser = 0;
  try {
    const result = await User.deleteOne({ _id: existingUser._id });
    removedUser = result?.deletedCount ?? 0;
  } catch (err) {
    console.error('Failed to remove user document during account deletion', { userId: String(existingUser._id), error: err });
  }

  const workos = await deleteWorkOSUser(existingUser.email);

  return {
    ok: purge.ok && removedUser > 0,
    userId: String(existingUser._id),
    mongo,
    r2: purge.r2,
    workos,
    removedUser,
  };
}

module.exports = {
  purgeUserData,
  deleteUserAccount,
};
