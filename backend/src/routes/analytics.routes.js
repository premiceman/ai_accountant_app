// backend/src/routes/analytics.routes.js
const express = require("express");
const dayjs = require("dayjs");
const Aggregates = require("../../models/Aggregates");
const Transaction = require("../../models/Transaction");
const PayrollFact = require("../../models/PayrollFact");
const auth = require("../../middleware/auth");

const router = express.Router();
router.use(auth);

function taxYearRange(d) {
  const date = dayjs(d);
  const year = date.month() > 2 || (date.month() === 2 && date.date() >= 6)
    ? date.year()
    : date.year() - 1;
  const start = dayjs(`${year}-04-06`).startOf("day");
  const end = start.add(1, "year").subtract(1, "day").endOf("day");
  return { start, end };
}

router.get("/summary", async (req, res) => {
  try {
    const { from, to } = req.query;
    const start = from ? dayjs(from).startOf("day") : taxYearRange(new Date()).start;
    const end = to ? dayjs(to).endOf("day") : taxYearRange(new Date()).end;
    const rangeKey = `${start.format("YYYY-MM-DD")}__${end.format("YYYY-MM-DD")}`;

    let agg = await Aggregates.findOne({ userId: req.user._id, rangeKey });
    if (!agg) {
      const tx = await Transaction.find({
        userId: req.user._id,
        date: { $gte: start.toDate(), $lte: end.toDate() }
      });
      const income = tx.filter(t => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
      const expenses = tx.filter(t => t.amount < 0).reduce((sum, t) => sum + Math.abs(t.amount), 0);
      const byCat = {};
      tx.forEach(t => { const c = t.category || "Uncategorised"; byCat[c] = (byCat[c] || 0) + Math.abs(t.amount); });
      const topCategories = Object.entries(byCat).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([name, amount]) => ({ name, amount }));

      const byMon = {};
      tx.forEach(t => {
        const k = dayjs(t.date).format("YYYY-MM");
        byMon[k] = byMon[k] || { income:0, expenses:0 };
        if (t.amount > 0) byMon[k].income += t.amount; else byMon[k].expenses += Math.abs(t.amount);
      });
      const months = Object.keys(byMon).sort().map(m => ({ month: m, ...byMon[m], net: byMon[m].income - byMon[m].expenses }));

      agg = await Aggregates.create({
        userId: req.user._id, rangeKey,
        summary: { income, expenses, net: income - expenses, topCategories },
        monthly: months
      });
    }

    const { start: tyStart, end: tyEnd } = taxYearRange(new Date());
    const payroll = await PayrollFact.find({
      userId: req.user._id, payDate: { $gte: tyStart.toDate(), $lte: tyEnd.toDate() }
    }).sort({ payDate: 1 });

    res.json({ summary: agg.summary, monthly: agg.monthly, payroll });
  } catch (e) {
    console.error("analytics summary error", e);
    res.status(500).json({ error: "failed" });
  }
});

module.exports = router;
