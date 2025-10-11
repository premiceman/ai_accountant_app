import { Readable } from 'stream';
import { extractPdfText } from '../../../../../shared/extraction/extractPdfText';
import logger from '../logger';
import { fileIdToKey, getObjectStream } from '../storage';

type ExtractResult = { text: string; pages: string[] };

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function extractText({ fileId, text }: { fileId: string; text?: string | null }): Promise<ExtractResult> {
  if (text?.trim()) {
    return { text, pages: text.split(/\n+/).map((line) => line.trim()).filter(Boolean) };
  }
  const key = fileIdToKey(fileId);
  const stream = await getObjectStream(key);
  if (!(stream instanceof Readable)) {
    throw new Error('Document body missing from storage response');
  }
  const buffer = await streamToBuffer(stream);
  const parsed = await extractPdfText(buffer);
  const finalText = parsed.fullText || buffer.toString('utf8');
  if (!finalText.trim()) {
    logger.warn({ fileId }, 'Empty text after extraction');
  }
  return { text: finalText, pages: parsed.pages };
}

export default extractText;
