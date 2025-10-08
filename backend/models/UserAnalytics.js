const mongoose = require('mongoose');

const UserAnalyticsSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    period: { type: String, required: true },
    builtAt: { type: Date, default: () => new Date() },
    sources: {
      payslips: { type: Number, default: 0 },
      statements: { type: Number, default: 0 },
      savings: { type: Number, default: 0 },
      isa: { type: Number, default: 0 },
      investments: { type: Number, default: 0 },
      hmrc: { type: Number, default: 0 },
    },
    income: {
      gross: { type: Number, default: 0 },
      net: { type: Number, default: 0 },
      other: { type: Number, default: 0 },
    },
    spend: {
      total: { type: Number, default: 0 },
      byCategory: {
        type: [
          new mongoose.Schema(
            {
              category: { type: String, required: true },
              outflow: { type: Number, required: true },
              share: { type: Number, required: true },
            },
            { _id: false }
          ),
        ],
        default: () => [],
      },
      largestExpenses: {
        type: [
          new mongoose.Schema(
            {
              description: { type: String, required: true },
              amount: { type: Number, required: true },
              month: { type: String, required: true },
            },
            { _id: false }
          ),
        ],
        default: () => [],
      },
    },
    cashflow: {
      inflows: { type: Number, default: 0 },
      outflows: { type: Number, default: 0 },
      net: { type: Number, default: 0 },
    },
    savings: {
      balance: { type: Number, default: 0 },
      interest: { type: Number, default: 0 },
    },
    investments: {
      balance: { type: Number, default: 0 },
      contributions: { type: Number, default: 0 },
      estReturn: { type: Number, default: 0 },
    },
    pension: {
      balance: { type: Number, default: 0 },
      contributions: { type: Number, default: 0 },
    },
    tax: {
      withheld: { type: Number, default: 0 },
      paidToHMRC: { type: Number, default: 0 },
      effectiveRate: { type: Number, default: 0 },
    },
    derived: {
      savingsRate: { type: Number, default: 0 },
      topMerchants: {
        type: [
          new mongoose.Schema(
            {
              name: { type: String, required: true },
              spend: { type: Number, required: true },
            },
            { _id: false }
          ),
        ],
        default: () => [],
      },
    },
  },
  { timestamps: true }
);

UserAnalyticsSchema.index({ userId: 1, period: 1 }, { unique: true });

module.exports = mongoose.model('UserAnalytics', UserAnalyticsSchema);
