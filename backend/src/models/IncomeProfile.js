// backend/src/models/IncomeProfile.js
const mongoose = require('mongoose');

const IncomeProfileSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true, unique: true },
  region: { type: String, enum: ['EnglandWales','Scotland'], default: 'EnglandWales' },
  salary: { type: Number, default: 0 },
  pensionPct: { type: Number, default: 0 },
  studentLoanPlan: { type: String, enum: ['plan1','plan2','plan4','pgl', null], default: null },
  taxCode: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('IncomeProfile', IncomeProfileSchema);
