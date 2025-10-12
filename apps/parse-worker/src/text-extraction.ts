import { parseString } from '@fast-csv/parse';
import { XMLParser } from 'fast-xml-parser';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import { normaliseWhitespace, chunkLines } from './utils';
import type { BoundingBox, ExtractedTextContent, LineGeometry, LineSegmentGeometry } from './types';

export type SupportedDocType = 'PDF' | 'DOCX' | 'TXT' | 'CSV' | 'XML' | string;

const LINE_Y_TOLERANCE = 4;

interface PdfLineItem {
  text: string;
  box: BoundingBox;
}

interface PdfLineGroup {
  pageNumber: number;
  items: PdfLineItem[];
  centerY: number;
  top: number;
}

interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
}

function unionBoxes(existing: BoundingBox | undefined, box: BoundingBox): BoundingBox {
  if (!existing) return { ...box };
  const left = Math.min(existing.left, box.left);
  const top = Math.min(existing.top, box.top);
  const right = Math.max(existing.left + existing.width, box.left + box.width);
  const bottom = Math.max(existing.top + existing.height, box.top + box.height);
  return {
    page: existing.page,
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

function buildPlainTextContent(text: string): ExtractedTextContent {
  const lines = chunkLines(text);
  const geometry: LineGeometry[] = lines.map((line, index) => ({
    lineIndex: index,
    text: line,
    segments: [],
  }));
  return { text, lines, geometry };
}

function mapSegmentsToLine(
  group: PdfLineGroup,
  lineIndex: number
): LineGeometry | null {
  if (!group.items.length) return null;
  const ordered = [...group.items].sort((a, b) => a.box.left - b.box.left);
  const rawSegments: { text: string; box?: BoundingBox }[] = [];
  ordered.forEach((item) => {
    const clean = item.text.replace(/\u00a0/g, ' ').replace(/[\t\n\r]+/g, ' ');
    if (!clean) return;
    rawSegments.push({ text: clean, box: item.box });
  });
  if (!rawSegments.length) return null;

  let cursor = 0;
  const rawTextParts: { start: number; end: number; text: string; box?: BoundingBox }[] = [];
  rawSegments.forEach((segment) => {
    const start = cursor;
    const end = cursor + segment.text.length;
    rawTextParts.push({ start, end, text: segment.text, box: segment.box });
    cursor = end;
  });

  const combined = rawTextParts.map((part) => part.text).join('');
  const trimmedStart = combined.length - combined.trimStart().length;
  const trimmedEnd = combined.trimEnd().length;
  if (trimmedEnd <= trimmedStart) return null;

  const segments: LineSegmentGeometry[] = [];
  let lineText = '';
  rawTextParts.forEach((part) => {
    const start = Math.max(part.start, trimmedStart);
    const end = Math.min(part.end, trimmedEnd);
    if (end <= start) return;
    const relativeStart = start - trimmedStart;
    const relativeEnd = end - trimmedStart;
    const sliceStart = start - part.start;
    const sliceEnd = end - part.start;
    const textSlice = part.text.slice(sliceStart, sliceEnd);
    lineText += textSlice;
    if (part.box) {
      segments.push({
        charStart: relativeStart,
        charEnd: relativeEnd,
        box: part.box,
      });
    }
  });

  if (!lineText.trim()) return null;

  const bounds = segments.reduce<BoundingBox | undefined>((acc, current) => unionBoxes(acc, current.box), undefined);

  return {
    lineIndex,
    text: lineText.trim(),
    pageNumber: group.pageNumber,
    segments,
    bounds,
  };
}

function multiplyTransforms(base: number[], extra: number[]): number[] {
  const [a1, b1, c1, d1, e1, f1] = base;
  const [a2, b2, c2, d2, e2, f2] = extra;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

function createBoundingBox(
  pageNumber: number,
  viewportHeight: number,
  transform: number[],
  item: PdfTextItem
): BoundingBox {
  const [a, b, c, d, e, f] = transform;
  const fontHeight = Math.hypot(b, d);
  const width = Math.hypot(a, c) * item.width;
  const top = viewportHeight - f - fontHeight;
  return {
    page: pageNumber,
    left: e,
    top,
    width,
    height: fontHeight,
  };
}

async function extractPdf(buffer: Buffer): Promise<ExtractedTextContent> {
  const geometry: LineGeometry[] = [];
  const lines: string[] = [];
  let globalLineIndex = 0;

  await pdfParse(buffer, {
    pagerender: async (pageData: any) => {
      const viewport = pageData.getViewport({ scale: 1 });
      const textContent = await pageData.getTextContent({ disableCombineTextItems: false });
      const pageNumber = pageData.pageNumber || pageData.pageIndex || pageData.page?._pageIndex + 1 || 1;

      const groups: PdfLineGroup[] = [];

      textContent.items.forEach((item: any) => {
        const textItem = item as PdfTextItem;
        if (!textItem || typeof textItem.str !== 'string') return;
        if (!textItem.transform || textItem.str.trim().length === 0) return;
        const transform = multiplyTransforms(viewport.transform, textItem.transform);
        const box = createBoundingBox(pageNumber, viewport.height, transform, textItem);
        const centerY = box.top + box.height / 2;

        let group = groups.find((entry) => Math.abs(entry.centerY - centerY) <= LINE_Y_TOLERANCE);
        if (!group) {
          group = {
            pageNumber,
            items: [],
            centerY,
            top: box.top,
          };
          groups.push(group);
        }

        group.items.push({
          text: textItem.str,
          box,
        });
        group.centerY = (group.centerY * (group.items.length - 1) + centerY) / group.items.length;
        group.top = Math.min(group.top, box.top);
      });

      const pageLines: string[] = [];
      groups
        .sort((a, b) => a.top - b.top)
        .forEach((group) => {
          const line = mapSegmentsToLine(group, globalLineIndex);
          if (!line) return;
          geometry.push(line);
          lines.push(line.text);
          pageLines.push(line.text);
          globalLineIndex += 1;
        });

      return pageLines.join('\n');
    },
  });

  const text = lines.join('\n');
  return { text, lines, geometry };
}

async function extractDocx(buffer: Buffer): Promise<ExtractedTextContent> {
  const result = await mammoth.extractRawText({ buffer });
  const text = normaliseWhitespace(result.value || '');
  return buildPlainTextContent(text);
}

async function extractTxt(buffer: Buffer): Promise<ExtractedTextContent> {
  const text = normaliseWhitespace(buffer.toString('utf8'));
  return buildPlainTextContent(text);
}

async function extractCsv(buffer: Buffer): Promise<ExtractedTextContent> {
  const rows: string[] = [];
  await new Promise<void>((resolve, reject) => {
    parseString(buffer.toString('utf8'), { trim: true })
      .on('error', reject)
      .on('data', (row: string[]) => {
        rows.push(row.join(' '));
      })
      .on('end', () => resolve());
  });
  const text = normaliseWhitespace(rows.join('\n'));
  return buildPlainTextContent(text);
}

async function extractXml(buffer: Buffer): Promise<ExtractedTextContent> {
  const parser = new XMLParser({ ignoreDeclaration: true, ignoreAttributes: false });
  const content = parser.parse(buffer.toString('utf8'));
  const text = normaliseWhitespace(JSON.stringify(content));
  return buildPlainTextContent(text);
}

export async function extractText(buffer: Buffer, docType: SupportedDocType): Promise<ExtractedTextContent> {
  const normalizedType = (docType || '').toUpperCase();
  if (normalizedType.includes('PDF')) return extractPdf(buffer);
  if (normalizedType.includes('DOCX') || normalizedType.includes('WORD')) return extractDocx(buffer);
  if (normalizedType.includes('CSV')) return extractCsv(buffer);
  if (normalizedType.includes('XML')) return extractXml(buffer);
  return extractTxt(buffer);
}
