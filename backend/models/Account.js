const mongoose = require('mongoose');

const AccountSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    institutionName: { type: String, required: true },
    rawInstitutionNames: { type: [String], default: () => [] },
    accountType: {
      type: String,
      enum: ['Current', 'Savings', 'ISA', 'Investments', 'Pension'],
      required: true,
    },
    accountNumberMasked: { type: String, required: true },
    displayName: { type: String, required: true },
    fingerprints: { type: [String], default: () => [] },
    firstSeenAt: { type: Date, default: () => new Date() },
    lastSeenAt: { type: Date, default: () => new Date() },
    closed: { type: Boolean, default: false },
  },
  { timestamps: true }
);

AccountSchema.index({ userId: 1, institutionName: 1, accountNumberMasked: 1, accountType: 1 }, { unique: true });

module.exports = mongoose.model('Account', AccountSchema);
