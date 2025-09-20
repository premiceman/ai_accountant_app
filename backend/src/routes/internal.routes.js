// backend/src/routes/internal.routes.js
const express = require("express");
const pdfParse = require("pdf-parse");
const dayjs = require("dayjs");
const { getObjectBuffer } = require("../utils/r2");
const Document = require("../../models/Document");
const Extraction = require("../../models/Extraction");
const Transaction = require("../../models/Transaction");
const PayrollFact = require("../../models/PayrollFact");
const Aggregates = require("../../models/Aggregates");

const router = express.Router();

function requireInternal(req, res, next) {
  const k = req.headers["x-internal-key"];
  if (k !== process.env.INTERNAL_API_KEY) return res.status(403).json({ error: "Forbidden" });
  return next();
}

// VALIDATE
router.post("/validate", requireInternal, async (req, res) => {
  try {
    const { docId } = req.body;
    const doc = await Document.findById(docId);
    if (!doc) return res.status(404).json({ error: "doc not found" });

    const buf = await getObjectBuffer(doc.storage.key);
    if (buf.length < 8) {
      doc.status = "failed";
      doc.validation = { score: 0, issues: [{ code: "EMPTY", msg: "Empty file" }] };
      await doc.save();
      return res.json({ status: doc.status });
    }

    const isPDF = buf.slice(0,4).toString() === "%PDF";
    if (!isPDF) {
      doc.status = "failed";
      doc.validation = { score: 0.2, issues: [{ code: "NOT_PDF", msg: "Only PDFs are supported in v1" }] };
      await doc.save();
      return res.json({ status: doc.status });
    }

    let detectedType = "other", score = 0.6, issues = [];
    const parsed = await pdfParse(buf).catch(()=>({ text:"" }));
    const text = parsed.text || "";

    if (/PAY\s*SLIP|Payslip/i.test(text)) { detectedType = "payslip"; score = 0.9; }
    if (/Statement\s+of\s+account|Bank\s+Statement/i.test(text)) { detectedType = "bank_statement"; score = Math.max(score, 0.85); }
    if (/UK|United Kingdom/i.test(text) && /(Passport|MRZ|P<)/i.test(text)) { detectedType = "passport"; score = Math.max(score, 0.8); }

    if (detectedType === "payslip") {
      if (!/Tax\s*Code|TAX\s*CODE/i.test(text)) issues.push({ code: "MISSING_TAX_CODE", msg: "No Tax Code found" });
      if (!/National\s+Insurance|NI\s+No/i.test(text)) issues.push({ code: "MISSING_NI", msg: "No NI number found" });
      if (!/Gross/i.test(text) || !/Net/i.test(text)) issues.push({ code: "MISSING_TOTALS", msg: "Gross/Net not found" });
    }

    doc.status = "validated";
    doc.validation = { detectedType, score, issues };
    await doc.save();
    res.json({ status: doc.status, detectedType, score, issues });
  } catch (e) {
    console.error("internal validate error", e);
    res.status(500).json({ error: "failed" });
  }
});

// EXTRACT
router.post("/extract", requireInternal, async (req, res) => {
  try {
    const { docId } = req.body;
    const doc = await Document.findById(docId);
    if (!doc) return res.status(404).json({ error: "doc not found" });

    const buf = await getObjectBuffer(doc.storage.key);
    const parsed = await pdfParse(buf).catch(()=>({ text: "" }));
    const text = parsed.text || "";
    const lines = text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);

    const out = { detectedType: doc.validation?.detectedType || doc.typeHint, confidence: doc.validation?.score || 0.6 };

    if (out.detectedType === "payslip") {
      const money = (labelPattern) => {
        const m = new RegExp(`${labelPattern}\\s*[:\\-]?\\s*£?\\s*([0-9,]+\\.?[0-9]{0,2})`, "i").exec(text);
        return m ? Number(m[1].replace(/,/g,"")) : undefined;
      };
      out.payslip = {
        employer: ((/Employer[:\s]+(.+)/i.exec(text)||[])[1]),
        employee: ((/Employee[:\s]+(.+)/i.exec(text)||[])[1]),
        payDate: dayjs((/Pay\s*Date[:\s]+([0-9\/\.\- ]+)/i.exec(text)||[])[1]).toDate(),
        period: ((/Period[:\s]+(.+)/i.exec(text)||[])[1]),
        gross: money("Gross"),
        net: money("Net"),
        tax: money("Tax"),
        ni: money("NI|National Insurance"),
        pension: money("Pension"),
        taxCode: ((/Tax\s*Code[:\s]+([A-Z0-9]+)/i.exec(text)||[])[1])
      };
    } else if (out.detectedType === "bank_statement") {
      const acc = ((/\bAccount\s*(?:No\.?|Number)[:\s]+([0-9]{6,8})/i.exec(text)||[])[1]);
      const sc = ((/\bSort\s*Code[:\s]+([0-9]{2}[- ]?[0-9]{2}[- ]?[0-9]{2})/i.exec(text)||[])[1]);
      const period = ((/\b(?:Period|From)[:\s]+([0-9\/\.\- ]+)\s+(?:to|–|-)\s+([0-9\/\.\- ]+)/i.exec(text)||[]));
      out.bank_statement = {
        accountNumber: acc, sortCode: sc,
        periodStart: dayjs(period[1]).toDate(), periodEnd: dayjs(period[2]).toDate()
      };

      const txRegex = /^(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(.+?)\s+([\-–]?\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s+(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)$/;
      for (const ln of lines) {
        const m = txRegex.exec(ln);
        if (m) {
          const [ , d, desc, amt, bal ] = m;
          await Transaction.updateOne(
            { userId: doc.userId, date: dayjs(d, ["DD/MM/YYYY","D/M/YYYY","DD/MM/YY"]).toDate(), amount: Number(String(amt).replace(/,/g,"")), description: desc, source: "bank_statement" },
            { $setOnInsert: {
              userId: doc.userId,
              date: dayjs(d, ["DD/MM/YYYY","D/M/YYYY","DD/MM/YY"]).toDate(),
              amount: Number(String(amt).replace(/,/g,"")),
              balance: Number(String(bal).replace(/,/g,"")),
              currency: "GBP",
              description: desc,
              category: "Uncategorised",
              source: "bank_statement",
              docId: doc._id
            }},
            { upsert: true }
          );
        }
      }
    }

    await Extraction.findOneAndUpdate(
      { docId: doc._id },
      { userId: doc.userId, ...out },
      { upsert: true, new: true }
    );

    doc.status = "extracted";
    await doc.save();
    res.json({ ok: true, type: out.detectedType });
  } catch (e) {
    console.error("internal extract error", e);
    res.status(500).json({ error: "failed" });
  }
});

// MATERIALIZE
router.post("/materialize", requireInternal, async (req, res) => {
  try {
    const { userId, from, to } = req.body;
    const start = dayjs(from).startOf("day").toDate();
    const end = dayjs(to).endOf("day").toDate();

    const tx = await Transaction.find({ userId, date: { $gte: start, $lte: end } });
    const income = tx.filter(t=>t.amount>0).reduce((a,b)=>a+b.amount,0);
    const expenses = tx.filter(t=>t.amount<0).reduce((a,b)=>a+Math.abs(b.amount),0);
    const byCat = {};
    tx.forEach(t => { const c = t.category || "Uncategorised"; byCat[c] = (byCat[c] || 0) + Math.abs(t.amount); });
    const topCategories = Object.entries(byCat).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([name,amount])=>({name,amount}));

    const byMon = {};
    tx.forEach(t => {
      const k = dayjs(t.date).format("YYYY-MM");
      byMon[k] = byMon[k] || { income:0, expenses:0 };
      if (t.amount > 0) byMon[k].income += t.amount; else byMon[k].expenses += Math.abs(t.amount);
    });
    const months = Object.keys(byMon).sort().map(m => ({ month: m, ...byMon[m], net: byMon[m].income - byMon[m].expenses }));

    const rangeKey = `${dayjs(start).format("YYYY-MM-DD")}__${dayjs(end).format("YYYY-MM-DD")}`;
    await Aggregates.findOneAndUpdate(
      { userId, rangeKey },
      { summary: { income, expenses, net: income-expenses, topCategories }, monthly: months },
      { upsert: true, new: true }
    );

    res.json({ ok: true });
  } catch (e) {
    console.error("internal materialize error", e);
    res.status(500).json({ error: "failed" });
  }
});

module.exports = router;
