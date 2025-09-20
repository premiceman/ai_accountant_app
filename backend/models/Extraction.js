const mongoose = require("mongoose");

const ExtractionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
  docId: { type: mongoose.Schema.Types.ObjectId, ref: "Document", unique: true },
  detectedType: String,
  textKey: String,
  fields: mongoose.Schema.Types.Mixed,
  payslip: {
    employer: String, employee: String, payDate: Date, period: String,
    gross: Number, net: Number, tax: Number, ni: Number, pension: Number, taxCode: String
  },
  bank_statement: {
    periodStart: Date, periodEnd: Date, account: String, sortCode: String, accountNumber: String,
    txCount: Number, totals: { in: Number, out: Number }
  },
  id_doc: {
    docType: String, name: String, dob: Date, expiry: Date, issuer: String, number: String, mrzPresent: Boolean
  },
  confidence: Number,
  warnings: [String]
}, { timestamps: true });

module.exports = mongoose.model("Extraction", ExtractionSchema);
