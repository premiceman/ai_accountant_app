const mongoose = require("mongoose");

const DocumentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true, required: true },
  collectionId: { type: mongoose.Schema.Types.ObjectId, ref: "VaultCollection" },
  filename: { type: String }, // original filename for UI
  typeHint: { type: String, enum: ["payslip","bank_statement","passport","driving_licence","P60","invoice","utility_bill","other"], default: "other" },
  storage: {
    provider: { type: String, default: "r2" },
    key: { type: String, required: true, index: true },
    size: Number,
    mime: String,
    sha256: String
  },
  status: { type: String, enum: ["uploaded_pending","validated","extracted","analytics_ready","failed"], default: "uploaded_pending", index: true },
  validation: {
    detectedType: String,
    score: Number,
    issues: [{ code: String, msg: String }]
  },
  pages: Number
}, { timestamps: true });

module.exports = mongoose.model("Document", DocumentSchema);
