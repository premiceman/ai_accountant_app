import { callOpenAIJson } from './openaiClient.js'; // existing client
export async function normaliseWithSchema(
  fullText: string,
  candidates: any,
  schemaDef: { name: string; schema: any; strict?: boolean }
) {
  const sys = 'You normalise financial documents. Return ONLY JSON conforming to the given JSON Schema. Do not invent values.';
  const user = [
    'TEXT:<<<', fullText, '>>>',
    '\nCANDIDATES:', JSON.stringify(candidates, null, 2),
    '\nSCHEMA:', JSON.stringify(schemaDef)
  ].join('\n');
  return callOpenAIJson({ system: sys, user, schema: schemaDef });
}
