import pdf from 'pdf-parse';
// Lazy import tesseract to avoid weight unless needed
type OCR = typeof import('tesseract.js');

export async function extractPdfText(buffer: Buffer): Promise<{ pages: string[]; fullText: string }> {
  const data = await pdf(buffer).catch(() => ({ text: '' } as any));
  let pages = data?.text ? data.text.split(/\f/g).map(s => s.trim()) : [];
  // OCR fallback per-page if page is too sparse
  if (!pages.length || pages.some(p => p.length < 30)) {
    const { createWorker } = (await import('tesseract.js')) as unknown as OCR;
    // NOTE: We keep this simple: OCR the whole buffer as one image if parse failed.
    // In production, rasterize per page; here suffice to unblock image-only PDFs.
    const worker = await createWorker('eng');
    const { data: { text } } = await worker.recognize(buffer as any);
    await worker.terminate();
    pages = text.split(/\n{2,}/).map(s => s.trim());
  }
  const fullText = pages.join('\n\n');
  return { pages, fullText };
}
