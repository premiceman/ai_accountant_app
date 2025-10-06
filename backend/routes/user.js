// backend/routes/user.js
const express = require('express');
const bcrypt = require('bcryptjs');
const auth = require('../middleware/auth');
const User = require('../models/User');
const PaymentMethod = require('../models/PaymentMethod');
const { computeMarketBenchmark } = require('../services/compensation/market');
let PDFDocument = null;
try {
  PDFDocument = require('pdfkit');
} catch (err) {
  console.warn('⚠️  pdfkit not available – PDF exports will be disabled.');
}
const { randomUUID } = require('crypto');

const router = express.Router();

function toPlain(obj) {
  if (!obj) return {};
  return typeof obj.toObject === 'function' ? obj.toObject() : { ...obj };
}

function normalisePackage(pkg = {}) {
  return {
    base: Number(pkg.base || 0),
    bonus: Number(pkg.bonus || 0),
    commission: Number(pkg.commission || 0),
    equity: Number(pkg.equity || 0),
    benefits: Number(pkg.benefits || 0),
    other: Number(pkg.other || 0),
    notes: String(pkg.notes || '')
  };
}

function packageTotal(pkg = {}) {
  return ['base', 'bonus', 'commission', 'equity', 'benefits', 'other'].reduce((sum, key) => sum + Number(pkg[key] || 0), 0);
}

function safeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function cleanText(value, max = 180) {
  if (value === undefined || value === null) return '';
  const str = String(value).trim();
  if (!max || str.length <= max) return str;
  return str.slice(0, max);
}

function safeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function estimateUkTax(pkg = {}) {
  const gross = packageTotal(pkg);
  const base = Number(pkg.base || 0);
  const allowance = 12570;
  const taxable = Math.max(0, gross - allowance);
  const higher = 50270;
  const additional = 125140;
  let tax = 0;
  if (taxable > 0) {
    const basic = Math.min(taxable, higher - allowance);
    tax += basic * 0.2;
    if (taxable > higher - allowance) {
      const highBand = Math.min(taxable - (higher - allowance), additional - higher);
      tax += highBand * 0.4;
    }
    if (taxable > additional - allowance) {
      tax += (taxable - (additional - allowance)) * 0.45;
    }
  }
  const ni = base > 12568 ? (base - 12568) * 0.12 : 0;
  const takeHome = Math.max(0, gross - tax - ni);
  const effectiveRate = gross > 0 ? (tax + ni) / gross : 0;
  return {
    gross,
    tax: Math.round(tax),
    nationalInsurance: Math.round(ni),
    takeHome: Math.round(takeHome),
    effectiveRate: Number(effectiveRate.toFixed(3)),
    notes: `Approximate PAYE for ${new Date().getFullYear()}/${String((new Date().getFullYear() + 1) % 100).padStart(2, '0')} without student loans.`
  };
}

function normaliseMarketBenchmark(block = {}) {
  if (!block || typeof block !== 'object') return {};
  const status = ['underpaid', 'fair', 'overpaid'].includes(block.status) ? block.status : 'unknown';
  const result = {
    status,
    ratio: safeNumber(block.ratio),
    summary: block.summary ? String(block.summary) : '',
    marketMedian: safeNumber(block.marketMedian),
    annualisedIncome: safeNumber(block.annualisedIncome),
    recommendedSalary: safeNumber(block.recommendedSalary),
    recommendedRaise: safeNumber(block.recommendedRaise),
    nextReview: safeDate(block.nextReview),
    updatedAt: safeDate(block.updatedAt) || new Date(),
    bands: null,
    promotionTimeline: null,
    sources: []
  };
  if (block.bands && typeof block.bands === 'object') {
    result.bands = {
      low: safeNumber(block.bands.low),
      median: safeNumber(block.bands.median),
      high: safeNumber(block.bands.high)
    };
  }
  if (block.promotionTimeline && typeof block.promotionTimeline === 'object') {
    const timeline = block.promotionTimeline;
    result.promotionTimeline = {
      monthsToPromotion: safeNumber(timeline.monthsToPromotion),
      targetTitle: timeline.targetTitle ? String(timeline.targetTitle) : '',
      windowStart: safeDate(timeline.windowStart),
      windowEnd: safeDate(timeline.windowEnd),
      confidence: timeline.confidence ? String(timeline.confidence) : null,
      notes: timeline.notes ? String(timeline.notes) : ''
    };
  }
  if (Array.isArray(block.sources)) {
    result.sources = block.sources.slice(0, 8).map((src) => ({
      label: src?.label ? String(src.label) : '',
      type: src?.type ? String(src.type) : 'data',
      weight: safeNumber(src?.weight)
    }));
  }
  return result;
}

function decorateSalaryNavigator(nav) {
  const data = toPlain(nav || {});
  data.package = normalisePackage(data.package || {});
  data.targetSalary = safeNumber(data.targetSalary);
  data.currentSalary = packageTotal(data.package);
  data.progress = data.targetSalary ? Math.min(100, Math.round((data.currentSalary / Number(data.targetSalary || 0)) * 100)) || 0 : 0;
  data.taxSummary = Object.keys(data.taxSummary || {}).length ? data.taxSummary : estimateUkTax(data.package);
  data.role = typeof data.role === 'string' ? data.role : '';
  data.company = typeof data.company === 'string' ? data.company : '';
  data.location = typeof data.location === 'string' ? data.location : '';
  data.tenure = safeNumber(data.tenure);
  data.marketBenchmark = normaliseMarketBenchmark(data.marketBenchmark || {});
  return data;
}

function normaliseAchievement(ach = {}) {
  return {
    id: ach.id || randomUUID(),
    title: String(ach.title || 'Achievement'),
    detail: String(ach.detail || ''),
    targetDate: ach.targetDate ? new Date(ach.targetDate) : null,
    status: ['planned','in_progress','complete'].includes(ach.status) ? ach.status : 'planned',
    evidenceUrl: ach.evidenceUrl || '',
    createdAt: ach.createdAt ? new Date(ach.createdAt) : new Date(),
    completedAt: ach.completedAt ? new Date(ach.completedAt) : null
  };
}

function normaliseCriterion(crit = {}) {
  return {
    id: crit.id || randomUUID(),
    title: String(crit.title || 'Criterion'),
    detail: String(crit.detail || ''),
    completed: !!crit.completed,
    createdAt: crit.createdAt ? new Date(crit.createdAt) : new Date(),
    completedAt: crit.completedAt ? new Date(crit.completedAt) : null
  };
}

function normaliseContract(contract) {
  if (!contract) return null;
  return {
    id: contract.id || null,
    name: contract.name || null,
    viewUrl: contract.viewUrl || null,
    downloadUrl: contract.downloadUrl || null,
    collectionId: contract.collectionId || null,
    linkedAt: contract.linkedAt ? new Date(contract.linkedAt) : new Date()
  };
}

function buildMockBenchmarks(pkg = {}, options = {}) {
  const opts = typeof options === 'string' ? { country: options } : (options || {});
  const country = (opts.country || 'uk').toLowerCase();
  const role = opts.role || 'Comparable role';
  const location = opts.location || country.toUpperCase();
  const tenure = safeNumber(opts.tenure);
  const base = packageTotal(pkg) || 45000;
  const tenureFactor = tenure ? Math.min(1.4, 1 + (tenure / 12)) : 1;
  const uplift = base * 0.08 * tenureFactor;
  const now = new Date();
  return [
    {
      id: randomUUID(),
      source: 'ONS Earnings',
      role: role,
      location: location,
      medianSalary: Math.round((base + uplift) * 1.02),
      percentiles: {
        p25: Math.round(base * 0.9 * tenureFactor),
        p50: Math.round((base + uplift) * tenureFactor),
        p75: Math.round((base + uplift * 2) * tenureFactor)
      },
      summary: 'Office for National Statistics data weighted for experience and location.',
      generatedAt: now
    },
    {
      id: randomUUID(),
      source: 'Recruitment platforms',
      role: role,
      location: location || 'Hybrid',
      medianSalary: Math.round((base + uplift * 1.2) * tenureFactor),
      percentiles: {
        p25: Math.round(base * tenureFactor),
        p50: Math.round((base + uplift * 1.2) * tenureFactor),
        p75: Math.round((base + uplift * 2.4) * tenureFactor)
      },
      summary: 'Aggregated from Indeed, Reed and Hays salary guides.',
      generatedAt: now
    },
    {
      id: randomUUID(),
      source: 'Industry peers',
      role: role,
      location: country === 'us' ? 'USA' : location,
      medianSalary: Math.round((base + uplift * 0.6) * tenureFactor),
      percentiles: {
        p25: Math.round(base * 0.95 * tenureFactor),
        p50: Math.round((base + uplift * 0.6) * tenureFactor),
        p75: Math.round((base + uplift * 1.5) * tenureFactor)
      },
      summary: 'Community-sourced packages adjusted for benefits and equity.',
      generatedAt: now
    }
  ];
}

function normaliseAsset(asset = {}) {
  return {
    id: asset.id || randomUUID(),
    name: String(asset.name || 'Asset'),
    value: Number(asset.value || 0),
    yield: asset.yield != null ? Number(asset.yield) : null,
    category: asset.category || 'other',
    notes: asset.notes || ''
  };
}

function normaliseLiability(liability = {}) {
  return {
    id: liability.id || randomUUID(),
    name: String(liability.name || 'Liability'),
    balance: Number(liability.balance || 0),
    rate: Number(liability.rate || 0),
    minimumPayment: Number(liability.minimumPayment || 0),
    notes: liability.notes || '',
    status: liability.status === 'closed' ? 'closed' : 'open'
  };
}

function normaliseGoal(goal = {}) {
  return {
    id: goal.id || randomUUID(),
    name: String(goal.name || 'Goal'),
    targetAmount: Number(goal.targetAmount || 0),
    targetDate: goal.targetDate ? new Date(goal.targetDate) : null,
    notes: goal.notes || ''
  };
}

function normaliseContributions(c = {}) {
  return { monthly: Number(c.monthly || 0) };
}

function monthsBetween(start, end) {
  const a = new Date(start);
  const b = new Date(end);
  if (!a || !b || Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.max(0, Math.round((b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())));
}

function computeWealth(plan) {
  const assets = Array.isArray(plan.assets) ? plan.assets : [];
  const liabilities = Array.isArray(plan.liabilities) ? plan.liabilities : [];
  const goals = Array.isArray(plan.goals) ? plan.goals : [];
  const contributions = plan.contributions || { monthly: 0 };
  const assetsTotal = assets.reduce((sum, a) => sum + Number(a.value || 0), 0);
  const liabilitiesTotal = liabilities.reduce((sum, l) => sum + Number(l.balance || 0), 0);
  const netWorth = assetsTotal - liabilitiesTotal;
  const denominator = assetsTotal + liabilitiesTotal;
  const ratio = denominator > 0 ? ((assetsTotal - liabilitiesTotal) / denominator) : 0;
  const strength = Math.max(0, Math.min(100, Math.round((ratio * 50) + 50)));
  const cashTotal = assets.filter((a) => ['cash','savings'].includes(String(a.category || '').toLowerCase())).reduce((sum, a) => sum + Number(a.value || 0), 0);
  const monthly = Math.max(0, Number(contributions.monthly || 0));
  const runwayMonths = monthly > 0 ? Math.max(0, Math.round(cashTotal / monthly)) : (cashTotal > 0 ? 0 : 0);

  const steps = [];
  let cursor = 1;
  liabilities.filter((l) => l.status !== 'closed').sort((a, b) => Number(b.rate || 0) - Number(a.rate || 0)).forEach((liab) => {
    const payment = Math.max(Number(liab.minimumPayment || 0), monthly || Number(liab.minimumPayment || 0));
    const months = payment > 0 ? Math.ceil(Number(liab.balance || 0) / payment) : null;
    steps.push({
      id: liab.id || randomUUID(),
      type: 'debt',
      title: `Clear ${liab.name}`,
      summary: `Allocate £${Math.round(payment).toLocaleString()} per month towards ${liab.name} at ${Number(liab.rate || 0).toFixed(2)}%.`,
      startMonth: cursor,
      endMonth: months ? cursor + months - 1 : null
    });
    if (months) cursor += months;
  });

  const milestones = goals.map((goal) => {
    const months = goal.targetDate ? monthsBetween(new Date(), goal.targetDate) || 12 : 12;
    const monthlyNeed = months > 0 ? Math.round(Number(goal.targetAmount || 0) / months) : Number(goal.targetAmount || 0);
    return {
      id: goal.id || randomUUID(),
      title: goal.name || 'Goal',
      description: `Allocate £${monthlyNeed.toLocaleString()} per month to reach £${Number(goal.targetAmount || 0).toLocaleString()}.`,
      date: goal.targetDate ? new Date(goal.targetDate) : null,
      amount: Number(goal.targetAmount || 0),
      monthlyContribution: monthlyNeed
    };
  });

  if (monthly > 0) {
    steps.push({
      id: randomUUID(),
      type: 'invest',
      title: 'Automate monthly investing',
      summary: `Invest the remaining £${monthly.toLocaleString()} per month into diversified accounts once high-interest debt clears.`,
      startMonth: cursor,
      endMonth: cursor + 12
    });
  }

  return {
    summary: {
      assetsTotal,
      liabilitiesTotal,
      netWorth,
      strength,
      runwayMonths,
      cashReserves: cashTotal,
      lastComputed: new Date()
    },
    strategy: {
      steps,
      milestones
    }
  };
}

function decorateWealth(plan) {
  const data = normalisePlanForResponse(plan);
  if (!data.summary || !Object.keys(data.summary).length) {
    const computed = computeWealth(data);
    data.summary = computed.summary;
    data.strategy = computed.strategy;
    data.lastComputed = computed.summary.lastComputed;
  }
  return data;
}

function normalisePlanForResponse(plan) {
  const base = {
    assets: [],
    liabilities: [],
    goals: [],
    contributions: { monthly: 0 },
    summary: {},
    strategy: { steps: [], milestones: [] },
    lastComputed: null
  };
  const plain = toPlain(plan || {});
  const merged = { ...base, ...plain };
  merged.assets = Array.isArray(plain.assets) ? plain.assets : [];
  merged.liabilities = Array.isArray(plain.liabilities) ? plain.liabilities : [];
  merged.goals = Array.isArray(plain.goals) ? plain.goals : [];
  merged.contributions = plain.contributions || { monthly: 0 };
  merged.summary = plain.summary || {};
  merged.strategy = plain.strategy || { steps: [], milestones: [] };
  merged.lastComputed = plain.lastComputed || null;
  return merged;
}

function currency(value) {
  return `£${Number(value || 0).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// Utility: shape user data for client (don't expose password/hash)
function publicUser(u) {
  if (!u) return null;
  return {
    id: u._id,
    firstName: u.firstName || '',
    lastName: u.lastName || '',
    username: u.username || '',
    email: u.email || '',
    dateOfBirth: u.dateOfBirth || null,
    licenseTier: u.licenseTier || 'free',
    roles: Array.isArray(u.roles) ? u.roles : ['user'],
    country: u.country || 'uk',
    emailVerified: !!u.emailVerified,
    subscription: u.subscription || { tier: 'free', status: 'inactive' },
    trial: u.trial || null,
    onboarding: u.onboarding || {},
    preferences: u.preferences || {},
    usageStats: u.usageStats || {},
    salaryNavigator: decorateSalaryNavigator(u.salaryNavigator || {}),
    wealthPlan: decorateWealth(u.wealthPlan || {}),
    integrations: u.integrations || [],
    eulaAcceptedAt: u.eulaAcceptedAt || null,
    eulaVersion: u.eulaVersion || null,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt
  };
}

// GET /api/user/me
router.get('/me', auth, async (req, res) => {
  const u = await User.findById(req.user.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  res.json(publicUser(u));
});

// PUT /api/user/me  (update your own profile)
router.put('/me', auth, async (req, res) => {
  const {
    firstName,
    lastName,
    username,
    email,
    country,
    preferences,
    onboarding
  } = req.body || {};
  if (!firstName || !lastName || !email) {
    return res.status(400).json({ error: 'firstName, lastName and email are required' });
  }

  try {
    // Check for unique email/username conflicts (excluding self)
    if (email) {
      const exists = await User.findOne({ email, _id: { $ne: req.user.id } }).lean();
      if (exists) return res.status(400).json({ error: 'Email already in use' });
    }
    if (username) {
      const existsU = await User.findOne({ username, _id: { $ne: req.user.id } }).lean();
      if (existsU) return res.status(400).json({ error: 'Username already in use' });
    }

    const existing = await User.findById(req.user.id);
    if (!existing) return res.status(404).json({ error: 'User not found' });
    const update = { firstName, lastName, email };
    if (typeof username === 'string') update.username = username;
    if (country && ['uk','us'].includes(country)) update.country = country;
    if (preferences && typeof preferences === 'object') {
      update.preferences = {
        ...(existing?.preferences?.toObject ? existing.preferences.toObject() : existing?.preferences || {}),
        ...preferences
      };
    }
    if (onboarding && typeof onboarding === 'object') {
      update.onboarding = {
        ...(existing?.onboarding?.toObject ? existing.onboarding.toObject() : existing?.onboarding || {}),
        ...onboarding
      };
    }

    const updated = await User.findByIdAndUpdate(
      req.user.id,
      { $set: update },
      { new: true }
    );
    res.json(publicUser(updated));
  } catch (e) {
    console.error('PUT /user/me error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/user/me/payment-methods
router.get('/me/payment-methods', auth, async (req, res) => {
  try {
    const methods = await PaymentMethod.find({ userId: req.user.id }).sort({ createdAt: -1 }).lean();
    res.json({ methods });
  } catch (e) {
    console.error('GET /user/me/payment-methods error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/user/preferences
router.patch('/preferences', auth, async (req, res) => {
  try {
    const { deltaMode, analyticsRange } = req.body || {};
    const update = {};
    if (deltaMode && ['absolute','percent'].includes(deltaMode)) {
      update['preferences.deltaMode'] = deltaMode;
    }
    if (analyticsRange && typeof analyticsRange === 'object') {
      update['preferences.analyticsRange'] = {
        preset: analyticsRange.preset || null,
        start: analyticsRange.start ? new Date(analyticsRange.start) : null,
        end: analyticsRange.end ? new Date(analyticsRange.end) : null
      };
    }
    const user = await User.findByIdAndUpdate(req.user.id, { $set: update }, { new: true });
    res.json({ preferences: user.preferences });
  } catch (e) {
    console.error('PATCH /user/preferences error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/user/onboarding
router.patch('/onboarding', auth, async (req, res) => {
  try {
    const { wizardCompleted, tourCompleted, goals } = req.body || {};
    const update = {};
    if (wizardCompleted) update['onboarding.wizardCompletedAt'] = new Date();
    if (tourCompleted) update['onboarding.tourCompletedAt'] = new Date();
    if (Array.isArray(goals)) update['onboarding.goals'] = goals.filter(Boolean);
    update['onboarding.lastPromptedAt'] = new Date();
    const user = await User.findByIdAndUpdate(req.user.id, { $set: update }, { new: true });
    res.json({ onboarding: user.onboarding });
  } catch (e) {
    console.error('PATCH /user/onboarding error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/user/salary-navigator
router.put('/salary-navigator', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const body = req.body || {};
    const nav = toPlain(user.salaryNavigator || {});
    let shouldRecomputeMarket = false;
    const explicitMarket = body.marketBenchmark !== undefined;
    if (body.package && typeof body.package === 'object') {
      nav.package = normalisePackage(body.package);
      shouldRecomputeMarket = true;
    }
    if (body.targetSalary !== undefined) nav.targetSalary = body.targetSalary != null ? Number(body.targetSalary) : null;
    if (body.nextReviewAt !== undefined) nav.nextReviewAt = body.nextReviewAt ? new Date(body.nextReviewAt) : null;
    if (body.role !== undefined) {
      nav.role = cleanText(body.role, 120);
      shouldRecomputeMarket = true;
    }
    if (body.company !== undefined) {
      nav.company = cleanText(body.company, 160);
      shouldRecomputeMarket = true;
    }
    if (body.location !== undefined) {
      nav.location = cleanText(body.location, 140);
      shouldRecomputeMarket = true;
    }
    if (body.tenure !== undefined) {
      const tenureVal = safeNumber(body.tenure);
      nav.tenure = tenureVal != null && tenureVal >= 0 ? Math.round(tenureVal * 100) / 100 : null;
      shouldRecomputeMarket = true;
    }
    if (Array.isArray(body.achievements)) nav.achievements = body.achievements.map(normaliseAchievement);
    if (Array.isArray(body.promotionCriteria)) nav.promotionCriteria = body.promotionCriteria.map(normaliseCriterion);
    if (body.contractFile !== undefined) nav.contractFile = normaliseContract(body.contractFile);
    if (Array.isArray(body.benchmarks)) {
      nav.benchmarks = body.benchmarks;
      shouldRecomputeMarket = true;
    }
    if (explicitMarket) nav.marketBenchmark = normaliseMarketBenchmark(body.marketBenchmark);
    nav.currentSalary = packageTotal(nav.package || {});
    nav.taxSummary = estimateUkTax(nav.package || {});
    if (shouldRecomputeMarket && !explicitMarket) {
      try {
        const computed = await computeMarketBenchmark({ user, navigator: nav });
        if (computed) nav.marketBenchmark = normaliseMarketBenchmark(computed);
      } catch (err) {
        console.warn('Unable to recompute market benchmark', err.message || err);
      }
    }
    user.salaryNavigator = nav;
    user.markModified('salaryNavigator');
    await user.save();
    res.json({ salaryNavigator: decorateSalaryNavigator(user.salaryNavigator) });
  } catch (err) {
    console.error('PUT /user/salary-navigator error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/user/salary-navigator/benchmark
router.post('/salary-navigator/benchmark', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const nav = toPlain(user.salaryNavigator || {});
    nav.package = normalisePackage(nav.package || {});
    const benchmarks = buildMockBenchmarks(nav.package, {
      country: user.country || 'uk',
      role: nav.role,
      location: nav.location,
      tenure: nav.tenure
    });
    nav.benchmarks = benchmarks;
    nav.benchmarkUpdatedAt = new Date();
    try {
      const marketBenchmark = await computeMarketBenchmark({ user, navigator: nav, benchmarks });
      if (marketBenchmark) {
        nav.marketBenchmark = normaliseMarketBenchmark(marketBenchmark);
        nav.marketBenchmarkUpdatedAt = new Date();
      }
    } catch (err) {
      console.warn('Market benchmark refresh failed', err.message || err);
    }
    user.salaryNavigator = nav;
    user.markModified('salaryNavigator');
    await user.save();
    res.json({ benchmarks: nav.benchmarks, marketBenchmark: nav.marketBenchmark });
  } catch (err) {
    console.error('POST /user/salary-navigator/benchmark error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/user/salary-navigator/export
router.get('/salary-navigator/export', auth, async (req, res) => {
  try {
    if (!PDFDocument) {
      return res.status(503).json({ error: 'PDF export is unavailable on this server.' });
    }
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const nav = decorateSalaryNavigator(user.salaryNavigator || {});
    const doc = new PDFDocument({ margin: 48 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="phloat-compensation-dossier.pdf"');
    doc.pipe(res);
    doc.fontSize(20).text('Phloat.io Compensation Navigator', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`User: ${user.firstName || ''} ${user.lastName || ''}`);
    doc.text(`Generated: ${new Date().toLocaleString()}`);
    doc.moveDown();
    doc.fontSize(14).text('Compensation snapshot', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(12).text(`Current total reward: ${currency(nav.currentSalary)}`);
    doc.text(`Target salary: ${nav.targetSalary ? currency(nav.targetSalary) : 'Not set'}`);
    doc.text(`Progress: ${nav.progress || 0}%`);
    doc.moveDown(0.5);
    doc.text('Package breakdown:');
    Object.entries(nav.package || {}).forEach(([key, value]) => {
      if (['notes'].includes(key)) return;
      doc.text(` • ${key}: ${currency(value)}`);
    });
    if (nav.package?.notes) {
      doc.text(`Notes: ${nav.package.notes}`);
    }
    doc.moveDown();
    doc.fontSize(14).text('Achievements', { underline: true });
    if (Array.isArray(nav.achievements) && nav.achievements.length) {
      nav.achievements.forEach((ach) => {
        doc.fontSize(12).text(`• ${ach.title} (${ach.status || 'planned'})`);
        if (ach.detail) doc.fontSize(10).fillColor('#555').text(ach.detail, { indent: 16 });
        doc.fillColor('black');
      });
    } else {
      doc.fontSize(12).text('No achievements recorded yet.');
    }
    doc.moveDown();
    doc.fontSize(14).text('Promotion criteria', { underline: true });
    if (Array.isArray(nav.promotionCriteria) && nav.promotionCriteria.length) {
      nav.promotionCriteria.forEach((crit) => {
        doc.fontSize(12).text(`• ${crit.title} ${crit.completed ? '(completed)' : ''}`);
        if (crit.detail) doc.fontSize(10).fillColor('#555').text(crit.detail, { indent: 16 });
        doc.fillColor('black');
      });
    } else {
      doc.fontSize(12).text('No promotion criteria captured.');
    }
    doc.moveDown();
    doc.fontSize(14).text('Benchmarks', { underline: true });
    if (Array.isArray(nav.benchmarks) && nav.benchmarks.length) {
      nav.benchmarks.forEach((b) => {
        doc.fontSize(12).text(`${b.source}: ${currency(b.medianSalary)} (P25 ${currency(b.percentiles?.p25)}, P75 ${currency(b.percentiles?.p75)})`);
        if (b.summary) doc.fontSize(10).fillColor('#555').text(b.summary, { indent: 16 });
        doc.fillColor('black');
      });
    } else {
      doc.fontSize(12).text('Benchmarks not generated.');
    }
    doc.end();
  } catch (err) {
    console.error('GET /user/salary-navigator/export error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/user/wealth-plan
router.put('/wealth-plan', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const body = req.body || {};
    const plan = toPlain(user.wealthPlan || {});
    if (Array.isArray(body.assets)) plan.assets = body.assets.map(normaliseAsset);
    if (Array.isArray(body.liabilities)) plan.liabilities = body.liabilities.map(normaliseLiability);
    if (Array.isArray(body.goals)) plan.goals = body.goals.map(normaliseGoal);
    if (body.contributions) plan.contributions = normaliseContributions(body.contributions);
    const computed = computeWealth(plan);
    plan.summary = computed.summary;
    plan.strategy = computed.strategy;
    plan.lastComputed = computed.summary.lastComputed;
    user.wealthPlan = plan;
    user.markModified('wealthPlan');
    await user.save();
    res.json({ wealthPlan: decorateWealth(user.wealthPlan) });
  } catch (err) {
    console.error('PUT /user/wealth-plan error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/user/wealth-plan/rebuild
router.post('/wealth-plan/rebuild', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const plan = toPlain(user.wealthPlan || {});
    const computed = computeWealth(plan);
    plan.summary = computed.summary;
    plan.strategy = computed.strategy;
    plan.lastComputed = computed.summary.lastComputed;
    user.wealthPlan = plan;
    user.markModified('wealthPlan');
    await user.save();
    res.json({ wealthPlan: decorateWealth(user.wealthPlan) });
  } catch (err) {
    console.error('POST /user/wealth-plan/rebuild error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/user/wealth-plan/export
router.get('/wealth-plan/export', auth, async (req, res) => {
  try {
    if (!PDFDocument) {
      return res.status(503).json({ error: 'PDF export is unavailable on this server.' });
    }
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const plan = decorateWealth(user.wealthPlan || {});
    const doc = new PDFDocument({ margin: 48 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="phloat-wealth-plan.pdf"');
    doc.pipe(res);
    doc.fontSize(20).text('Phloat.io Wealth Strategy Lab', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`User: ${user.firstName || ''} ${user.lastName || ''}`);
    doc.text(`Generated: ${new Date().toLocaleString()}`);
    doc.moveDown();
    doc.fontSize(14).text('Summary', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(12).text(`Net worth: ${currency(plan.summary?.netWorth)}`);
    doc.text(`Assets: ${currency(plan.summary?.assetsTotal)}  Liabilities: ${currency(plan.summary?.liabilitiesTotal)}`);
    doc.text(`Financial strength: ${plan.summary?.strength ?? 0}/100`);
    doc.text(`Cash runway: ${plan.summary?.runwayMonths ?? 0} months`);
    doc.moveDown();
    doc.fontSize(14).text('Assets', { underline: true });
    if (Array.isArray(plan.assets) && plan.assets.length) {
      plan.assets.forEach((asset) => {
        doc.fontSize(12).text(`• ${asset.name}: ${currency(asset.value)} (${asset.category || 'other'})`);
      });
    } else {
      doc.fontSize(12).text('No assets recorded.');
    }
    doc.moveDown();
    doc.fontSize(14).text('Liabilities', { underline: true });
    if (Array.isArray(plan.liabilities) && plan.liabilities.length) {
      plan.liabilities.forEach((liab) => {
        doc.fontSize(12).text(`• ${liab.name}: ${currency(liab.balance)} at ${Number(liab.rate || 0).toFixed(2)}% (${liab.status || 'open'})`);
      });
    } else {
      doc.fontSize(12).text('No liabilities recorded.');
    }
    doc.moveDown();
    doc.fontSize(14).text('Goals', { underline: true });
    if (Array.isArray(plan.goals) && plan.goals.length) {
      plan.goals.forEach((goal) => {
        const date = goal.targetDate ? new Date(goal.targetDate).toLocaleDateString() : '—';
        doc.fontSize(12).text(`• ${goal.name}: ${currency(goal.targetAmount)} by ${date}`);
        if (goal.notes) doc.fontSize(10).fillColor('#555').text(goal.notes, { indent: 16 });
        doc.fillColor('black');
      });
    } else {
      doc.fontSize(12).text('No goals defined.');
    }
    doc.moveDown();
    doc.fontSize(14).text('Strategy', { underline: true });
    if (Array.isArray(plan.strategy?.steps) && plan.strategy.steps.length) {
      plan.strategy.steps.forEach((step) => {
        doc.fontSize(12).text(`• ${step.title} (${step.startMonth != null ? `Month ${step.startMonth}` : ''}${step.endMonth ? ` → ${step.endMonth}` : ''})`);
        if (step.summary) doc.fontSize(10).fillColor('#555').text(step.summary, { indent: 16 });
        doc.fillColor('black');
      });
    } else {
      doc.fontSize(12).text('Strategy will generate after adding assets, liabilities and goals.');
    }
    doc.end();
  } catch (err) {
    console.error('GET /user/wealth-plan/export error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/user/change-password
router.post('/change-password', auth, async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body || {};
  if (!currentPassword || !newPassword || !confirmPassword) {
    return res.status(400).json({ error: 'All password fields are required' });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'New password and confirmation do not match' });
  }
  if (String(newPassword).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  try {
    const u = await User.findById(req.user.id);
    if (!u || !u.password) return res.status(400).json({ error: 'Invalid account' });

    const ok = await bcrypt.compare(currentPassword, u.password);
    if (!ok) return res.status(400).json({ error: 'Current password is incorrect' });

    const hash = await bcrypt.hash(newPassword, 10);
    u.password = hash;
    await u.save();

    res.json({ ok: true, message: 'Password updated' });
  } catch (e) {
    console.error('POST /user/change-password error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

