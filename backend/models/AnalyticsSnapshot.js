const mongoose = require('mongoose');

const IncomeSourceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    total: { type: Number, required: true },
  },
  { _id: false }
);

const SpendCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    total: { type: Number, required: true },
  },
  { _id: false }
);

const CashflowSchema = new mongoose.Schema(
  {
    net: { type: Number, default: 0 },
    trend3m: { type: Number, default: null },
    trend6m: { type: Number, default: null },
  },
  { _id: false }
);

const TaxesSchema = new mongoose.Schema(
  {
    incomeTaxYTD: { type: Number, default: 0 },
    niYTD: { type: Number, default: 0 },
    studentLoanYTD: { type: Number, default: 0 },
    pensionYTD: { type: Number, default: 0 },
  },
  { _id: false }
);

const BalancesSchema = new mongoose.Schema(
  {
    opening: { type: Number, default: null },
    closing: { type: Number, default: null },
  },
  { _id: false }
);

const AnomalySchema = new mongoose.Schema(
  {
    kind: { type: String, required: true },
    amount: { type: Number, required: true },
    date: { type: Date, required: true },
    note: { type: String, default: null },
  },
  { _id: false }
);

const AnalyticsSnapshotSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    period: {
      month: { type: String, required: true },
      start: { type: Date, required: true },
      end: { type: Date, required: true },
    },
    metrics: {
      income: {
        total: { type: Number, default: 0 },
        bySource: { type: [IncomeSourceSchema], default: () => [] },
      },
      spend: {
        total: { type: Number, default: 0 },
        byCategory: { type: [SpendCategorySchema], default: () => [] },
        essentialsPct: { type: Number, default: 0 },
        discretionPct: { type: Number, default: 0 },
      },
      savingsRatePct: { type: Number, default: null },
      cashflow: { type: CashflowSchema, default: () => ({}) },
      taxes: { type: TaxesSchema, default: () => ({}) },
      balances: { type: BalancesSchema, default: () => ({}) },
      anomalies: { type: [AnomalySchema], default: () => [] },
    },
  },
  {
    collection: 'analytics_snapshots',
    timestamps: { createdAt: true, updatedAt: false },
  }
);

AnalyticsSnapshotSchema.index({ userId: 1, 'period.month': -1 }, { unique: true });

AnalyticsSnapshotSchema.set('toJSON', {
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('AnalyticsSnapshot', AnalyticsSnapshotSchema);
