// backend/models/Subscription.js
const mongoose = require('mongoose');

const SubscriptionSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
  // ✅ Accept both 'professional' and legacy 'premium'
  plan:     { type: String, enum: ['free','basic','professional','premium'], required: true },
  price:    { type: Number, required: true },
  currency: { type: String, default: 'GBP' },
  status:   { type: String, enum: ['active','canceled'], default: 'active', index: true },
  interval: { type: String, enum: ['monthly','yearly'], default: 'monthly', index: true },
  startedAt:{ type: Date, default: Date.now }
}, { timestamps: true });

/** Canonicalise legacy 'premium' → 'professional' on save */
SubscriptionSchema.pre('save', function(next) {
  if (this.plan === 'premium') this.plan = 'professional';
  next();
});

module.exports = mongoose.model('Subscription', SubscriptionSchema);
