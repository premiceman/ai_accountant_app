const { mongoose } = require('./index');

const AnalyticsSnapshotV2Schema = new mongoose.Schema({
  userId: { type: String, index: true, required: true },
  periodType: { type: String, enum: ['month', 'taxYear'], required: true },
  periodValue: { type: String, required: true },
  metrics: { type: Object, required: true },
  sourceRefs: {
    type: [{ fileId: String, page: Number, anchor: String }],
    default: [],
  },
  updatedAt: { type: Date, default: Date.now },
}, {
  collection: 'analytics_snapshots_v2',
});

AnalyticsSnapshotV2Schema.index({ userId: 1, periodType: 1, periodValue: 1 }, { unique: true });

module.exports = mongoose.model('AnalyticsSnapshotV2', AnalyticsSnapshotV2Schema);
