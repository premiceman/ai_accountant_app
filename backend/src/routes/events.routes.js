// backend/src/routes/events.routes.js
const express = require('express');
const router = express.Router();
const Event = require('../../models/Event');
const auth = require('../../middleware/auth');

// ----- Helpers -----

// UK Tax Year 2025/26
const TAX_YEAR_START = new Date('2025-04-06T00:00:00.000Z');
const TAX_YEAR_END   = new Date('2026-04-05T23:59:59.999Z');

/**
 * Default events authored by the app for 2025/26.
 * Shown in black; not deletable.
 * Keep descriptions concise; they appear as hover tooltips.
 */
function getDefaultEvents() {
  const defaults = [
    { title: 'Tax year starts (allowances reset)',           date: '2025-04-06', description: 'Start of 2025/26 UK tax year. ISA/CGT/dividend allowances reset.' },
    { title: 'P60 available (keep for records)',             date: '2025-05-31', description: 'Employers provide P60 by 31 May for the previous tax year.' },
    { title: 'P11D/benefits statement due to employees',     date: '2025-07-06', description: 'Employers give P11D/P11D(b) benefits-in-kind information to employees.' },
    { title: 'Self Assessment: 2nd payment on account (24/25)', date: '2025-07-31', description: 'If applicable for 2024/25, make the second payment on account by 31 July.' },
    { title: 'Register for Self Assessment (if required)',    date: '2025-10-05', description: 'Deadline to register for SA if you need to file and have not before.' },
    { title: 'Self Assessment paper return deadline (24/25)', date: '2025-10-31', description: 'Paper filing deadline for 2024/25 Self Assessment.' },
    { title: 'SA via PAYE option deadline',                   date: '2025-12-30', description: 'File online by 30 Dec to have less than £3,000 collected via your PAYE code (if eligible).' },
    { title: 'Online SA + balancing payment + 1st POA',       date: '2026-01-31', description: 'Online Self Assessment filing deadline for 2024/25. Pay balancing tax and first 2025/26 payment on account (if due).' },
    { title: 'Tax year ends (last day to use 25/26 allowances)', date: '2026-04-05', description: 'End of 2025/26 tax year. Final day to use ISA, CGT, & dividend allowances.' },

    // Quarterly doc reminders for statements/records (helpful for Vault)
    { title: 'Q1 statements: download & upload', date: '2025-06-30', description: 'Collect bank/broker statements for Apr–Jun and upload to Document Vault.' },
    { title: 'Q2 statements: download & upload', date: '2025-09-30', description: 'Collect bank/broker statements for Jul–Sep and upload to Document Vault.' },
    { title: 'Q3 statements: download & upload', date: '2025-12-31', description: 'Collect bank/broker statements for Oct–Dec and upload to Document Vault.' },
    { title: 'Q4 statements: download & upload', date: '2026-03-31', description: 'Collect bank/broker statements for Jan–Mar and upload to Document Vault.' },
  ];

  // Normalize to full objects with source flag
  return defaults.map((d, i) => ({
    id: `default-${i}`,
    title: d.title,
    date: new Date(`${d.date}T00:00:00.000Z`),
    description: d.description,
    source: 'default',
    deletable: false,
  }));
}

/**
 * Expand a recurring user event into concrete dates within the tax year.
 * Supports monthly, quarterly (every 3 months), yearly.
 */
function expandRecurrence(anchorDate, recurrence) {
  const out = [];
  if (!anchorDate || recurrence === 'none') return out;

  const start = new Date(anchorDate);
  const pushIfInYear = (dt) => {
    if (dt >= TAX_YEAR_START && dt <= TAX_YEAR_END) out.push(new Date(dt));
  };

  const monthAdd = (d, months) => {
    const nd = new Date(d);
    const targetMonth = nd.getUTCMonth() + months;
    const y = nd.getUTCFullYear() + Math.floor(targetMonth / 12);
    const m = ((targetMonth % 12) + 12) % 12;
    const day = Math.min(
      nd.getUTCDate(),
      [31, (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m]
    );
    return new Date(Date.UTC(y, m, day, nd.getUTCHours(), nd.getUTCMinutes(), nd.getUTCSeconds()));
  };

  if (recurrence === 'monthly') {
    let cur = new Date(start);
    while (cur < TAX_YEAR_START) cur = monthAdd(cur, 1);
    while (cur <= TAX_YEAR_END) { pushIfInYear(cur); cur = monthAdd(cur, 1); }
  } else if (recurrence === 'quarterly') {
    let cur = new Date(start);
    while (cur < TAX_YEAR_START) cur = monthAdd(cur, 3);
    while (cur <= TAX_YEAR_END) { pushIfInYear(cur); cur = monthAdd(cur, 3); }
  } else if (recurrence === 'yearly') {
    const yearOcc1 = new Date(Date.UTC(2025, start.getUTCMonth(), start.getUTCDate()));
    const yearOcc2 = new Date(Date.UTC(2026, start.getUTCMonth(), start.getUTCDate()));
    [yearOcc1, yearOcc2].forEach((d) => pushIfInYear(d));
  }

  return out;
}

// Extract userId from auth (JWT only)
function getUserId(req) {
  return (req.user && (req.user.id || req.user._id)) || null;
}

// ----- Routes -----

// GET /api/events
// Returns default events + user events (recurrences expanded) within 2025/26 tax year
router.get('/', async (req, res) => {
  try {
    const userId = getUserId(req);
    const defaults = getDefaultEvents();

    let userEvents = [];
    if (userId) {
      userEvents = await Event.find({
        userId,
        date: { $lte: TAX_YEAR_END },
      })
        .sort({ date: 1 })
        .lean();
    }

    const expandedUser = [];
    for (const e of userEvents) {
      if (e.recurrence === 'none') {
        const dt = new Date(e.date);
        if (dt >= TAX_YEAR_START && dt <= TAX_YEAR_END) {
          expandedUser.push({
            id: e._id.toString(),
            baseId: e._id.toString(),
            title: e.title,
            date: dt,
            description: e.description || '',
            source: 'user',
            deletable: true,
          });
        }
      } else {
        const dates = expandRecurrence(e.date, e.recurrence);
        dates.forEach((dt, idx) => {
          expandedUser.push({
            id: `${e._id.toString()}::${idx}`,        // occurrence id for UI
            baseId: e._id.toString(),                 // used for deletion of the series
            title: e.title,
            date: dt,
            description: e.description || '',
            source: 'user',
            deletable: true,
          });
        });
      }
    }

    const merged = [...defaults, ...expandedUser].sort((a, b) => a.date - b.date);

    res.json({
      taxYear: '2025/26',
      start: TAX_YEAR_START,
      end: TAX_YEAR_END,
      events: merged,
    });
  } catch (err) {
    console.error('GET /api/events error:', err);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// POST /api/events (must be authed)
// Body: { title, date, recurrence('none'|'monthly'|'quarterly'|'yearly'), description }
router.post('/', auth, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorised' });

    const { title, date, recurrence = 'none', description = '' } = req.body || {};
    if (!title || typeof title !== 'string' || title.trim().length === 0)
      return res.status(400).json({ error: 'Title is required' });
    if (title.length > 50) return res.status(400).json({ error: 'Title too long (max 50 chars)' });
    if (!date) return res.status(400).json({ error: 'Date is required' });
    const dt = new Date(date);
    if (isNaN(dt.getTime())) return res.status(400).json({ error: 'Invalid date' });
    const allowed = ['none', 'monthly', 'quarterly', 'yearly'];
    if (!allowed.includes(recurrence)) return res.status(400).json({ error: 'Invalid recurrence' });

    const saved = await Event.create({
      userId,
      title: title.trim(),
      date: dt,
      recurrence,
      description: (description || '').trim(),
      source: 'user',
    });

    res.status(201).json({ id: saved._id.toString() });
  } catch (err) {
    console.error('POST /api/events error:', err);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// DELETE /api/events/:id  (must be authed; only user-created; default events cannot be deleted)
router.delete('/:id', auth, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorised' });

    // Accept either the base Mongo _id or an expanded "baseId::n" occurrence id
    const raw = req.params.id || '';
    const id = String(raw).split('::')[0];

    const existing = await Event.findOne({ _id: id, userId });
    if (!existing) return res.status(404).json({ error: 'Event not found' });

    await Event.deleteOne({ _id: id, userId });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/events/:id error:', err);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

module.exports = router;
