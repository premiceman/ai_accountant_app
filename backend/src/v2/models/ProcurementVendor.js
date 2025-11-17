const { mongoose } = require('./index');

const ContactSchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    role: { type: String, default: '' },
    email: { type: String, default: '' },
    phone: { type: String, default: '' },
    timezone: { type: String, default: '' },
    notes: { type: String, default: '' },
  },
  { _id: false },
);

const ObjectiveSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String, default: '' },
    owner: { type: String, default: '' },
    metric: { type: String, default: '' },
    targetValue: { type: String, default: '' },
    dueDate: { type: Date, default: null },
    status: {
      type: String,
      enum: ['not_started', 'on_track', 'at_risk', 'off_track', 'completed'],
      default: 'not_started',
    },
    progress: { type: Number, min: 0, max: 100, default: 0 },
    successCriteria: { type: String, default: '' },
    dependencies: { type: String, default: '' },
    lastReviewedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

const UpdateSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      enum: ['general', 'meeting', 'risk', 'action', 'success'],
      default: 'general',
    },
    summary: { type: String, required: true },
    actions: { type: [String], default: [] },
    recordedBy: { type: String, default: '' },
    recordedAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const RiskSchema = new mongoose.Schema(
  {
    statement: { type: String, default: '' },
    impact: { type: String, default: '' },
    mitigation: { type: String, default: '' },
    owner: { type: String, default: '' },
    status: { type: String, enum: ['open', 'watching', 'closed'], default: 'open' },
  },
  { _id: true },
);

const ProcurementVendorSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    name: { type: String, required: true },
    category: { type: String, default: '' },
    stage: {
      type: String,
      enum: ['prospect', 'trial', 'active', 'sunset', 'offboarded'],
      default: 'prospect',
    },
    owner: { type: String, default: '' },
    annualValue: { type: Number, default: 0 },
    currency: { type: String, default: 'USD' },
    renewalDate: { type: Date, default: null },
    paymentTerms: { type: String, default: '' },
    relationshipHealth: {
      type: String,
      enum: ['excellent', 'good', 'caution', 'at_risk'],
      default: 'good',
    },
    riskLevel: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'low' },
    tags: { type: [String], default: [] },
    contacts: { type: [ContactSchema], default: [] },
    objectives: { type: [ObjectiveSchema], default: [] },
    updates: { type: [UpdateSchema], default: [] },
    risks: { type: [RiskSchema], default: [] },
    relationshipBrief: { type: String, default: '' },
    successPlan: { type: String, default: '' },
    lastTouchpointAt: { type: Date, default: null },
    nextReviewAt: { type: Date, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.model('ProcurementVendor', ProcurementVendorSchema);
