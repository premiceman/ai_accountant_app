const { config } = require('../config');

async function fetchCompletion(prompt, signal = AbortSignal.timeout(30000)) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.openai.apiKey}`,
    },
    body: JSON.stringify({
      model: config.openai.model,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are a seasoned procurement and vendor management leader. Provide concise relationship briefs, risk callouts, and success objectives that a procurement manager can action immediately.',
        },
        { role: 'user', content: prompt },
      ],
    }),
    signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI procurement request failed (${response.status}): ${text}`);
  }
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI response missing content');
  }
  return JSON.parse(content);
}

function buildPrompt(vendor) {
  return JSON.stringify({
    vendor: {
      name: vendor.name,
      category: vendor.category,
      stage: vendor.stage,
      annualValue: vendor.annualValue,
      renewalDate: vendor.renewalDate,
      riskLevel: vendor.riskLevel,
      relationshipHealth: vendor.relationshipHealth,
      objectives: vendor.objectives?.map((objective) => ({
        title: objective.title,
        status: objective.status,
        progress: objective.progress,
        metric: objective.metric,
        target: objective.targetValue,
        dueDate: objective.dueDate,
      })),
      updates: vendor.updates?.slice(-5).map((update) => ({
        category: update.category,
        summary: update.summary,
        recordedAt: update.recordedAt,
        actions: update.actions,
      })),
      risks: vendor.risks?.map((risk) => ({
        statement: risk.statement,
        impact: risk.impact,
        mitigation: risk.mitigation,
        status: risk.status,
      })),
    },
    instructions: {
      format: {
        brief: 'string',
        quickWins: ['string'],
        objectives: [
          {
            title: 'string',
            metric: 'string',
            targetValue: 'string',
            dueDate: 'YYYY-MM-DD',
            status: 'on_track|at_risk|off_track|not_started',
            actions: ['string'],
          },
        ],
        risks: [
          { statement: 'string', impact: 'string', mitigation: 'string', priority: 'low|medium|high' },
        ],
      },
      tone: 'Concise and actionable. Use bullet points where possible.',
    },
  });
}

async function generateRelationshipBrief(vendor, signal = AbortSignal.timeout(30000)) {
  const prompt = buildPrompt(vendor);
  const completion = await fetchCompletion(prompt, signal);
  return {
    brief: completion.brief || 'Relationship summary unavailable.',
    quickWins: Array.isArray(completion.quickWins) ? completion.quickWins : [],
    objectives: Array.isArray(completion.objectives) ? completion.objectives : [],
    risks: Array.isArray(completion.risks) ? completion.risks : [],
  };
}

module.exports = { generateRelationshipBrief };
