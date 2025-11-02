const { mongoose } = require('./index');

const ProvenanceSchema = new mongoose.Schema({
  fileId: { type: String, required: true },
  page: { type: Number, required: true },
  anchor: { type: String, required: true },
}, { _id: false });

const PayslipMetricsV2Schema = new mongoose.Schema({
  userId: { type: String, index: true, required: true },
  fileId: { type: String, required: true },
  contentHash: { type: String, required: true },
  payPeriod: {
    start: { type: String, required: true },
    end: { type: String, required: true },
    paymentDate: { type: String, required: true },
  },
  grossPay: { type: Number, required: true },
  netPay: { type: Number, required: true },
  deductions: {
    incomeTax: { type: Number, required: true },
    nationalInsurance: { type: Number, required: true },
    pension: { type: Number, required: true },
    studentLoan: { type: Number, required: true },
    otherDeductions: { type: Number, required: true },
  },
  provenance: { type: ProvenanceSchema, required: true },
  createdAt: { type: Date, default: Date.now },
}, {
  collection: 'payslip_metrics_v2',
});

PayslipMetricsV2Schema.index({ userId: 1, fileId: 1 }, { unique: true });

module.exports = mongoose.model('PayslipMetricsV2', PayslipMetricsV2Schema);
