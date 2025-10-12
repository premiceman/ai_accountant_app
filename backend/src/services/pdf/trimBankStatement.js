'use strict';
const pdfParse = require('pdf-parse');
const { PDFDocument } = require('pdf-lib');

function scorePage(text) {
  const t = (text || '').replace(/\s+/g,' ').trim();
  const include = [
    /transactions?/i, /statement/i, /\bdate\b/i, /\bdescription\b/i, /\bamount\b/i,
    /\bbalance\b/i, /\bdebit\b/i, /\bcredit\b/i, /opening balance/i, /closing balance/i
  ];
  const exclude = [
    /glossary/i, /important information/i, /contact/i, /help/i, /fraud/i, /security/i,
    /terms/i, /conditions/i, /privacy/i, /advert/i, /offers?/i, /\bnotes?\b/i
  ];
  let s = 0;
  include.forEach(r => { if (r.test(t)) s += 2; });
  exclude.forEach(r => { if (r.test(t)) s -= 3; });
  const curr = (t.match(/£|\$|€|\bGBP\b|\bUSD\b|\bEUR\b/g) || []).length;
  const nums = (t.match(/\b\d{1,3}(?:[,\s]\d{3})*(?:\.\d{2})?\b/g) || []).length;
  s += Math.min(curr, 20);
  s += Math.min(Math.floor(nums/10), 10);
  return s;
}

async function extractPageTexts(buffer) {
  const pages = [];
  await pdfParse(buffer, {
    pagerender: async (page) => {
      const c = await page.getTextContent();
      const txt = c.items.map(i => i.str).join(' ');
      pages.push(txt);
      return txt;
    }
  });
  return pages;
}

/** Trim to page 1 + pages scoring >= threshold (auto preserves at least one extra page if present). */
async function trimBankStatement(buffer, { minScore = 5 } = {}) {
  const src = await PDFDocument.load(buffer);
  const pageCount = src.getPageCount();
  const texts = await extractPageTexts(buffer);
  const keep = new Set([0]);
  const scoreByPage = [];

  for (let i = 1; i < texts.length; i++) {
    const s = scorePage(texts[i]);
    scoreByPage[i] = s;
    if (s >= minScore) keep.add(i);
  }
  if (keep.size === 1 && pageCount > 1) {
    let best = { idx: 1, s: -Infinity };
    for (let i = 1; i < texts.length; i++) { const s = scorePage(texts[i]); if (s > best.s) best = { idx:i, s }; }
    keep.add(best.idx);
  }
  const indices = [...keep].sort((a,b)=>a-b);

  if (indices.length === pageCount) {
    return { buffer, keptPages: indices, originalPageCount: pageCount, scoreByPage };
  }

  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, indices);
  copied.forEach(p => out.addPage(p));
  const trimmed = Buffer.from(await out.save());
  return { buffer: trimmed, keptPages: indices, originalPageCount: pageCount, scoreByPage };
}

module.exports = { trimBankStatement };
