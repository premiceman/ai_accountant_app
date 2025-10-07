// backend/models/User.js
const mongoose = require('mongoose');
const crypto = require('crypto');

function generateUid() {
  const rand = crypto.randomBytes(12).toString('base64url');
  return 'u_' + rand.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

const IntegrationSchema = new mongoose.Schema({
  key:          { type: String, required: true },
  label:        { type: String, required: true },
  status:       { type: String, enum: ['not_connected','pending','error','connected'], default: 'not_connected' },
  lastCheckedAt:{ type: Date, default: null },
  metadata:     { type: mongoose.Schema.Types.Mixed, default: {} },
}, { _id: false });

const IntegrationSessionSchema = new mongoose.Schema({
  provider:   { type: String, required: true },
  state:      { type: String, required: true },
  codeVerifier:{ type: String, required: true },
  institution:{ type: mongoose.Schema.Types.Mixed, default: {} },
  scopes:     { type: [String], default: [] },
  createdAt:  { type: Date, default: Date.now },
  metadata:   { type: mongoose.Schema.Types.Mixed, default: {} }
}, { _id: false });

const SalaryNavigatorSchema = new mongoose.Schema({
  targetSalary:      { type: Number, default: null },
  currentSalary:     { type: Number, default: null },
  nextReviewAt:      { type: Date, default: null },
  role:              { type: String, default: '' },
  company:           { type: String, default: '' },
  location:          { type: String, default: '' },
  tenure:            { type: Number, default: null },
  package:{
    base:       { type: Number, default: 0 },
    bonus:      { type: Number, default: 0 },
    commission: { type: Number, default: 0 },
    equity:     { type: Number, default: 0 },
    benefits:   { type: Number, default: 0 },
    other:      { type: Number, default: 0 },
    notes:      { type: String, default: '' }
  },
  contractFileId:    { type: mongoose.Schema.Types.ObjectId, ref: 'VaultFile', default: null },
  contractFile: {
    id:          { type: String, default: null },
    name:        { type: String, default: null },
    viewUrl:     { type: String, default: null },
    downloadUrl: { type: String, default: null },
    collectionId:{ type: String, default: null },
    linkedAt:    { type: Date, default: null }
  },
  benefits:          { type: mongoose.Schema.Types.Mixed, default: {} },
  achievements:      { type: [mongoose.Schema.Types.Mixed], default: [] },
  promotionCriteria: { type: [mongoose.Schema.Types.Mixed], default: [] },
  benchmarks:        { type: [mongoose.Schema.Types.Mixed], default: [] },
  marketBenchmark:   { type: mongoose.Schema.Types.Mixed, default: {} },
  taxSummary:        { type: mongoose.Schema.Types.Mixed, default: {} }
}, { _id: false });

const WealthPlanSchema = new mongoose.Schema({
  goals:        { type: [mongoose.Schema.Types.Mixed], default: [] },
  assets:       { type: [mongoose.Schema.Types.Mixed], default: [] },
  liabilities:  { type: [mongoose.Schema.Types.Mixed], default: [] },
  contributions:{
    monthly: { type: Number, default: 0 }
  },
  strategy:     { type: mongoose.Schema.Types.Mixed, default: {} },
  summary:      { type: mongoose.Schema.Types.Mixed, default: {} },
  lastComputed: { type: Date, default: null },
}, { _id: false });

const UserSchema = new mongoose.Schema({
  firstName: { type: String, trim: true, required: true },
  lastName:  { type: String, trim: true, required: true },
  username:  { type: String, trim: true }, // no unique index (we validate at app level)
  email:     { type: String, trim: true, unique: true, required: true },
  password:  { type: String, required: true },

  dateOfBirth: { type: Date, default: null },

  uid:       { type: String, unique: true, index: true, default: generateUid },

  licenseTier: {
    type: String,
    enum: ['free', 'starter', 'growth', 'premium'],
    default: 'free'
  },
  roles:      { type: [String], default: ['user'] },
  country:    { type: String, enum: ['uk', 'us'], default: 'uk' },

  eulaAcceptedAt:{ type: Date, default: null },
  eulaVersion:   { type: String, default: null },

  emailVerified: { type: Boolean, default: false },
  emailVerification: {
    token:     { type: String, default: null },
    expiresAt: { type: Date, default: null },
    sentAt:    { type: Date, default: null }
  },

  trial: {
    startedAt: { type: Date, default: null },
    endsAt:    { type: Date, default: null },
    coupon:    { type: String, default: null },
    requiresPaymentMethod: { type: Boolean, default: true }
  },

  subscription: {
    tier:         { type: String, default: 'free' },
    status:       { type: String, enum: ['inactive','trial','active','past_due','canceled'], default: 'inactive' },
    lastPlanChange:{ type: Date, default: null },
    renewsAt:     { type: Date, default: null }
  },

  integrations: { type: [IntegrationSchema], default: [] },
  integrationSessions: { type: [IntegrationSessionSchema], default: [] },

  onboarding: {
    wizardCompletedAt: { type: Date, default: null },
    tourCompletedAt:   { type: Date, default: null },
    goals:             { type: [String], default: [] },
    lastPromptedAt:    { type: Date, default: null }
  },

  usageStats: {
    documentsUploaded:   { type: Number, default: 0 },
    documentsRequiredMet:{ type: Number, default: 0 },
    documentsHelpfulMet: { type: Number, default: 0 },
    documentsAnalyticsMet: { type: Number, default: 0 },
    documentsRequiredCompleted: { type: Number, default: 0 },
    documentsHelpfulCompleted: { type: Number, default: 0 },
    documentsAnalyticsCompleted: { type: Number, default: 0 },
    documentsRequiredTotal: { type: Number, default: 0 },
    documentsHelpfulTotal:  { type: Number, default: 0 },
    documentsAnalyticsTotal: { type: Number, default: 0 },
    documentsProgressUpdatedAt: { type: Date, default: null },
    documentsCatalogue: { type: mongoose.Schema.Types.Mixed, default: {} },
    moneySavedEstimate:  { type: Number, default: 0 },
    hmrcFilingsComplete: { type: Number, default: 0 },
    minutesActive:       { type: Number, default: 0 }
  },

  documentInsights: { type: mongoose.Schema.Types.Mixed, default: {} },

  salaryNavigator: { type: SalaryNavigatorSchema, default: () => ({}) },
  wealthPlan:      { type: WealthPlanSchema, default: () => ({}) },

  preferences: {
    deltaMode: { type: String, enum: ['absolute','percent'], default: 'absolute' },
    analyticsRange: {
      preset: { type: String, default: 'last-quarter' },
      start:  { type: Date, default: null },
      end:    { type: Date, default: null }
    }
  }
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);
