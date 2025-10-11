import { parseString } from '@fast-csv/parse';
import { XMLParser } from 'fast-xml-parser';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import { normaliseWhitespace } from './utils';

export type SupportedDocType = 'PDF' | 'DOCX' | 'TXT' | 'CSV' | 'XML' | string;

async function extractPdf(buffer: Buffer): Promise<string> {
  const result = await pdfParse(buffer);
  return normaliseWhitespace(result.text || '');
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return normaliseWhitespace(result.value || '');
}

async function extractTxt(buffer: Buffer): Promise<string> {
  return normaliseWhitespace(buffer.toString('utf8'));
}

async function extractCsv(buffer: Buffer): Promise<string> {
  const rows: string[] = [];
  await new Promise<void>((resolve, reject) => {
    parseString(buffer.toString('utf8'), { trim: true })
      .on('error', reject)
      .on('data', (row: string[]) => {
        rows.push(row.join(' '));
      })
      .on('end', () => resolve());
  });
  return normaliseWhitespace(rows.join('\n'));
}

async function extractXml(buffer: Buffer): Promise<string> {
  const parser = new XMLParser({ ignoreDeclaration: true, ignoreAttributes: false });
  const content = parser.parse(buffer.toString('utf8'));
  return normaliseWhitespace(JSON.stringify(content));
}

export async function extractText(buffer: Buffer, docType: SupportedDocType): Promise<string> {
  const normalizedType = (docType || '').toUpperCase();
  if (normalizedType.includes('PDF')) return extractPdf(buffer);
  if (normalizedType.includes('DOCX') || normalizedType.includes('WORD')) return extractDocx(buffer);
  if (normalizedType.includes('CSV')) return extractCsv(buffer);
  if (normalizedType.includes('XML')) return extractXml(buffer);
  return extractTxt(buffer);
}
