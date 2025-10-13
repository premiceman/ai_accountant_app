"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.callOpenAIJson = exports.callStructuredExtraction = void 0;
const fetchImpl = typeof globalThis.fetch === 'function' ? globalThis.fetch : null;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_EXTRACTION_MODEL = process.env.OPENAI_EXTRACTION_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
async function postChatCompletion(body) {
    const fetch = fetchImpl;
    if (!fetch || !OPENAI_API_KEY)
        return null;
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
    try {
        return await res.json();
    }
    catch (err) {
        console.warn('[shared:openaiClient] failed to parse response body', err);
        return null;
    }
}
function ensureJsonInstruction(source, append) {
    if (!source)
        return append.trim();
    return source.toLowerCase().includes('json') ? source : `${source}${append}`;
}
async function callStructuredExtraction(prompt, schema, options = {}) {
    const fetch = fetchImpl;
    if (!fetch || !OPENAI_API_KEY)
        return null;
    try {
        const baseSystemPrompt = options.systemPrompt || 'You are a meticulous financial analyst that extracts structured payroll data as json.';
        const systemPrompt = ensureJsonInstruction(baseSystemPrompt, ' Always respond with valid json.');
        const userPrompt = ensureJsonInstruction(prompt, '\n\nReturn the results as valid json.');
        const makeBody = (format) => ({
            model: OPENAI_EXTRACTION_MODEL,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            temperature: 0,
            response_format: format,
            ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
        });
        const schemaFormat = schema ? { type: 'json_schema', json_schema: schema } : { type: 'json_object' };
        let data = await postChatCompletion(makeBody(schemaFormat));
        if (!data && schema) {
            console.warn('[shared:openaiClient] json_schema request failed, retrying with json_object');
            data = await postChatCompletion(makeBody({ type: 'json_object' }));
        }
        if (!data)
            return null;
        const content = data?.choices?.[0]?.message?.content;
        if (!content)
            return null;
        try {
            return JSON.parse(content);
        }
        catch (err) {
            console.warn('[shared:openaiClient] failed to parse JSON response', err);
            return null;
        }
    }
    catch (err) {
        console.warn('[shared:openaiClient] extraction call failed', err);
        return null;
    }
}
exports.callStructuredExtraction = callStructuredExtraction;
async function callOpenAIJson({ system, user, schema, maxTokens }) {
    const systemPrompt = ensureJsonInstruction(system, ' Always respond with valid json.');
    const userPrompt = ensureJsonInstruction(user, '\n\nReturn the results as valid json.');
    const makeBody = (format) => ({
        model: OPENAI_EXTRACTION_MODEL,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ],
        temperature: 0,
        response_format: format,
        ...(maxTokens ? { max_tokens: maxTokens } : {}),
    });
    const schemaFormat = schema ? { type: 'json_schema', json_schema: schema } : { type: 'json_object' };
    let data = await postChatCompletion(makeBody(schemaFormat));
    if (!data && schema) {
        console.warn('[shared:openaiClient] json_schema request failed, retrying with json_object');
        data = await postChatCompletion(makeBody({ type: 'json_object' }));
    }
    if (!data)
        return null;
    const content = data?.choices?.[0]?.message?.content;
    if (!content)
        return null;
    try {
        return JSON.parse(content);
    }
    catch (err) {
        console.warn('[shared:openaiClient] failed to parse JSON response', err);
        return null;
    }
}
exports.callOpenAIJson = callOpenAIJson;
