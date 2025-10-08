const PDF_HEADER = Buffer.from('%PDF');

export function isPdf(buffer: Buffer): boolean {
  if (!buffer || buffer.length < PDF_HEADER.length) {
    return false;
  }
  return buffer.subarray(0, PDF_HEADER.length).equals(PDF_HEADER);
}
