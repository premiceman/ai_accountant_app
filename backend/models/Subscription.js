// backend/models/Subscription.js
const mongoose = require('mongoose');

const SubscriptionSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
  plan:     { type: String, enum: ['free','basic','professional'], required: true },
  price:    { type: Number, required: true },
  currency: { type: String, default: 'GBP' },
  status:   { type: String, enum: ['active','canceled'], default: 'active', index: true },
  // 👇 NEW: persist billing interval so Yearly sticks
  interval: { type: String, enum: ['monthly','yearly'], default: 'monthly', index: true },
  startedAt:{ type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Subscription', SubscriptionSchema);

