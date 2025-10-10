import type { Buffer } from 'node:buffer';

export type ExtractedPdfText = { pages: string[]; fullText: string };

type ExtractPdfTextModule = {
  extractPdfText(buffer: Buffer): Promise<ExtractedPdfText>;
};

export async function extractPdfText(buffer: Buffer): Promise<ExtractedPdfText> {
  const mod = (await import('./extractPdfText.js')) as ExtractPdfTextModule;
  return mod.extractPdfText(buffer);
}
