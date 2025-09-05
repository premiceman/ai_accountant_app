// backend/models/PaymentMethod.js
const mongoose = require('mongoose');

const PaymentMethodSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
  brand:    { type: String, trim: true },      // e.g., Visa, MasterCard (derived), "Card"
  last4:    { type: String, trim: true },      // only last 4 stored
  expMonth: { type: Number, min: 1, max: 12 },
  expYear:  { type: Number },
  holder:   { type: String, trim: true },
  isDefault:{ type: Boolean, default: false }
  // NOTE: For production, never store PAN or CVC. Use a PSP (Stripe) token.
}, { timestamps: true });

module.exports = mongoose.model('PaymentMethod', PaymentMethodSchema);
