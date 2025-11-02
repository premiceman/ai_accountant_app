const { sha256 } = require('../utils/hashing');
const { config } = require('../config');
const AdviceItemV1 = require('../models/AdviceItemV1');
const AnalyticsSnapshotV2 = require('../models/AnalyticsSnapshotV2');

async function fetchAdviceCompletion(prompt, signal) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.openai.apiKey}`,
    },
    body: JSON.stringify({
      model: config.openai.model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are an expert financial advisor who only uses provided analytics to draft actionable advice.' },
        { role: 'user', content: prompt },
      ],
    }),
    signal,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${text}`);
  }
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI response missing content');
  }
  return JSON.parse(content);
}

function buildPrompt({ monthly, taxYear }) {
  return JSON.stringify({
    monthly,
    taxYear,
    instructions: {
      requiredShape: {
        items: [
          {
            topic: 'string',
            severity: 'info|warning|urgent',
            confidence: '0-1 float',
            summary: 'string',
            actions: ['string'],
            sourceRefs: [
              { fileId: 'string', page: 1, anchor: 'string' },
            ],
          },
        ],
      },
      rules: [
        'Only reference numeric values present in the analytics payload',
        'Always include at least one actionable recommendation',
        'Copy provenance from sourceRefs arrays exactly',
      ],
    },
  });
}

function normaliseAdvice(raw) {
  if (!raw || !Array.isArray(raw.items)) {
    throw new Error('OpenAI advice payload invalid');
  }
  return raw.items.map((item, index) => ({
    topic: item.topic || `advice-${index + 1}`,
    severity: item.severity || 'info',
    confidence: Number(item.confidence ?? 0.5),
    summary: item.summary || 'Review your finances.',
    actions: Array.isArray(item.actions) ? item.actions.filter(Boolean) : [],
    sourceRefs: Array.isArray(item.sourceRefs) ? item.sourceRefs.filter(Boolean) : [],
  }));
}

async function generateAdvice(userId, signal = AbortSignal.timeout(30000)) {
  const monthly = await AnalyticsSnapshotV2.find({ userId, periodType: 'month' }).sort({ periodValue: -1 }).limit(6);
  const taxYear = await AnalyticsSnapshotV2.find({ userId, periodType: 'taxYear' }).sort({ periodValue: -1 }).limit(1);
  const payload = {
    monthly: monthly.map((doc) => ({ period: doc.periodValue, metrics: doc.metrics, sourceRefs: doc.sourceRefs })),
    taxYear: taxYear.map((doc) => ({ period: doc.periodValue, metrics: doc.metrics, sourceRefs: doc.sourceRefs })),
  };
  const prompt = buildPrompt(payload);
  const promptVersionHash = sha256(Buffer.from(`${config.openai.promptVersion}:${prompt}`));
  const result = await fetchAdviceCompletion(prompt, signal);
  const adviceItems = normaliseAdvice(result);
  await AdviceItemV1.deleteMany({ userId });
  await AdviceItemV1.insertMany(
    adviceItems.map((item) => ({
      userId,
      topic: item.topic,
      severity: item.severity,
      confidence: item.confidence,
      actions: item.actions,
      summary: item.summary,
      sourceRefs: item.sourceRefs,
      model: config.openai.model,
      promptVersionHash,
      createdAt: new Date(),
    })),
  );
  return adviceItems;
}

async function listAdvice(userId) {
  return AdviceItemV1.find({ userId }).sort({ createdAt: -1 });
}

module.exports = { generateAdvice, listAdvice };
