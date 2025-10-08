const PDF_HEADER = Buffer.from('%PDF');

function isPdf(buffer) {
  if (!buffer || buffer.length < PDF_HEADER.length) return false;
  return buffer.subarray(0, PDF_HEADER.length).equals(PDF_HEADER);
}

module.exports = { isPdf };
