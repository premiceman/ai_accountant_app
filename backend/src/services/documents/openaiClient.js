const fetch = typeof globalThis.fetch === 'function' ? globalThis.fetch : null;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_EXTRACTION_MODEL = process.env.OPENAI_EXTRACTION_MODEL
  || process.env.OPENAI_MODEL
  || 'gpt-4o-mini';

async function callStructuredExtraction(prompt, schema, options = {}) {
  if (!fetch || !OPENAI_API_KEY) return null;
  try {
    const systemPrompt = options.systemPrompt
      || 'You are a meticulous financial analyst that extracts structured payroll data.';
    const responseFormat = schema
      ? { type: 'json_schema', json_schema: schema }
      : { type: 'json_object' };
    const body = {
      model: OPENAI_EXTRACTION_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: 0,
      response_format: responseFormat,
    };

    if (options.maxTokens) body.max_tokens = options.maxTokens;

    const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      console.warn('[documents:openai] request failed', res.status, text);
      return null;
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;
    try {
      return JSON.parse(content);
    } catch (err) {
      console.warn('[documents:openai] failed to parse JSON response', err);
      return null;
    }
  } catch (err) {
    console.warn('[documents:openai] extraction call failed', err);
    return null;
  }
}

module.exports = {
  callStructuredExtraction,
};
