// backend/models/Subscription.js
const mongoose = require('mongoose');

const SubscriptionSchema = new mongoose.Schema({
  userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
  plan:    { type: String, enum: ['free','basic','premium'], required: true },
  price:   { type: Number, default: 0 },     // cents or currency units (we keep units for demo)
  currency:{ type: String, default: 'USD' },
  status:  { type: String, enum: ['active','canceled'], default: 'active' },
  startedAt: { type: Date, default: () => new Date() },
  currentPeriodEnd: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('Subscription', SubscriptionSchema);
