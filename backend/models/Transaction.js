const mongoose = require("mongoose");

const TxSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
  date: { type: Date, index: true },
  amount: Number,
  balance: Number,
  currency: { type: String, default: "GBP" },
  description: String,
  counterparty: String,
  category: String,
  source: { type: String, enum: ["bank_statement","truelayer"], index: true },
  docId: { type: mongoose.Schema.Types.ObjectId, ref: "Document" }
}, { timestamps: true });

TxSchema.index({ userId: 1, date: 1 });

module.exports = mongoose.model("Transaction", TxSchema);
