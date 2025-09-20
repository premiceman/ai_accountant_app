const mongoose = require("mongoose");

const PayrollFactSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
  payDate: { type: Date, index: true },
  period: String,
  employer: String,
  gross: Number, net: Number, tax: Number, ni: Number, pension: Number,
  docId: { type: mongoose.Schema.Types.ObjectId, ref: "Document" }
}, { timestamps: true });

module.exports = mongoose.model("PayrollFact", PayrollFactSchema);
