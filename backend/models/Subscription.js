// backend/models/Subscription.js
const mongoose = require('mongoose');

const SubscriptionSchema = new mongoose.Schema(
  {
    userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },

    // Supported plans align with updated licensing model.
    plan:    { type: String, enum: ['free','starter','growth','premium'], required: true },

    // Store the billing interval so 'yearly' doesn't get lost.
    interval: { type: String, enum: ['monthly','yearly'], default: 'monthly', index: true },

    price:   { type: Number, default: 0 },     // currency units (demo)
    currency:{ type: String, default: 'USD' }, // routes set GBP explicitly; default kept for safety
    status:  { type: String, enum: ['active','canceled'], default: 'active' },

    startedAt: { type: Date, default: () => new Date() },
    currentPeriodEnd: { type: Date, default: null }
  },
  {
    timestamps: true,
    // Expose the virtual below if anyone ever serializes the doc
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Back-compat alias: some code may look for `billingInterval`.
// This ensures reads/writes to that name hit `interval`.
SubscriptionSchema.virtual('billingInterval')
  .get(function () { return this.interval; })
  .set(function (v) { this.interval = String(v || '').toLowerCase().trim(); });

module.exports = mongoose.model('Subscription', SubscriptionSchema);
