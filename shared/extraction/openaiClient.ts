const fetchImpl: typeof fetch | null = typeof globalThis.fetch === 'function' ? globalThis.fetch : null;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_EXTRACTION_MODEL =
  process.env.OPENAI_EXTRACTION_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';

type ExtractionSchema = Record<string, unknown> & { name?: string; strict?: boolean };

type ExtractionOptions = {
  systemPrompt?: string;
  maxTokens?: number;
};

export async function callStructuredExtraction<T = unknown>(
  prompt: string,
  schema?: ExtractionSchema | null,
  options: ExtractionOptions = {}
): Promise<T | null> {
  const fetch = fetchImpl;
  if (!fetch || !OPENAI_API_KEY) return null;
  try {
    const systemPrompt =
      options.systemPrompt || 'You are a meticulous financial analyst that extracts structured payroll data.';
    const responseFormat = schema
      ? { type: 'json_schema', json_schema: { ...schema, strict: true } }
      : { type: 'json_object' };
    const body: Record<string, unknown> = {
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
      console.warn('[shared:openaiClient] request failed', res.status, text);
      return null;
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;
    try {
      return JSON.parse(content) as T;
    } catch (err) {
      console.warn('[shared:openaiClient] failed to parse JSON response', err);
      return null;
    }
  } catch (err) {
    console.warn('[shared:openaiClient] extraction call failed', err);
    return null;
  }
}

export type { ExtractionOptions };
