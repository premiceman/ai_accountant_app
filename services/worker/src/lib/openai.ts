import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

let sharedClientPromise: Promise<any> | null = null;

function resolveSharedModule(relativePath: string): string {
  const candidates = [
    path.resolve(process.cwd(), 'shared', relativePath),
    path.resolve(__dirname, '../../../shared', relativePath),
    path.resolve(__dirname, '../../../../shared', relativePath),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return pathToFileURL(candidate).href;
    }
  }
  throw new Error(`Unable to resolve shared module: ${relativePath}`);
}

async function loadSharedClient(): Promise<any> {
  if (!sharedClientPromise) {
    sharedClientPromise = import(resolveSharedModule('extraction/openaiClient.js'));
  }
  return sharedClientPromise;
}

export type CallOpenAIJsonParams = {
  system: string;
  user: string;
  schema?: Record<string, unknown>;
  maxTokens?: number;
};

export async function callOpenAIJson<T = unknown>(params: CallOpenAIJsonParams): Promise<T | null> {
  const module = await loadSharedClient();
  if (typeof module.callOpenAIJson !== 'function') {
    throw new Error('Shared OpenAI client does not expose callOpenAIJson');
  }
  return module.callOpenAIJson(params);
}
