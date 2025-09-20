const mongoose = require("mongoose");

const AggSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
  rangeKey: { type: String, index: true },
  summary: {
    income: Number, expenses: Number, net: Number,
    topCategories: [{ name: String, amount: Number }]
  },
  monthly: [{ month: String, income: Number, expenses: Number, net: Number }]
}, { timestamps: true });

AggSchema.index({ userId: 1, rangeKey: 1 }, { unique: true });

module.exports = mongoose.model("Aggregates", AggSchema);
