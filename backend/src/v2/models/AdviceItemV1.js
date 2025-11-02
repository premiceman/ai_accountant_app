const { mongoose } = require('./index');

const AdviceItemSchema = new mongoose.Schema({
  userId: { type: String, index: true, required: true },
  topic: { type: String, required: true },
  severity: { type: String, required: true },
  confidence: { type: Number, required: true },
  actions: { type: [String], default: [] },
  summary: { type: String, required: true },
  sourceRefs: {
    type: [{ fileId: String, page: Number, anchor: String }],
    default: [],
  },
  model: { type: String, required: true },
  promptVersionHash: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
}, {
  collection: 'advice_items_v1',
});

AdviceItemSchema.index({ userId: 1, topic: 1 }, { unique: true });

module.exports = mongoose.model('AdviceItemV1', AdviceItemSchema);
