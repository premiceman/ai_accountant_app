// backend/routes/user.js
const express = require('express');
const bcrypt = require('bcryptjs');
const auth = require('../middleware/auth');
const User = require('../models/User');
const PaymentMethod = require('../models/PaymentMethod');
const Subscription = require('../models/Subscription');
const { computeWealth } = require('../services/wealth/engine');
let PDFDocument = null;
try {
  PDFDocument = require('pdfkit');
} catch (err) {
  console.warn('⚠️  pdfkit not available – PDF exports will be disabled.');
}
const { randomUUID } = require('crypto');

const router = express.Router();

function escapeRegex(str = '') {
  return String(str).replace(/[.*+\-?^${}()|[\]\\]/g, '\$&');
}

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

function normaliseSurveyAnswers(list = []) {
  if (!Array.isArray(list)) return [];
  return list.map((item) => ({
    id: String(item?.id || item?.questionId || ''),
    question: String(item?.question || ''),
    response: (() => {
      const val = String(item?.response || '').toLowerCase();
      if (['yes','no','not_sure','not sure','unsure','maybe'].includes(val)) {
        if (val === 'not sure' || val === 'unsure' || val === 'maybe') return 'not_sure';
        return val;
      }
      return 'not_sure';
    })(),
    weight: Number.isFinite(Number(item?.weight)) ? Number(item.weight) : null
  }));
}

function normaliseOnboardingSurvey(block = {}) {
  const plain = toPlain(block || {});
  return {
    interests: Array.isArray(plain.interests) ? plain.interests : [],
    motivations: Array.isArray(plain.motivations) ? plain.motivations : [],
    valueSignals: normaliseSurveyAnswers(plain.valueSignals),
    tierSignals: normaliseSurveyAnswers(plain.tierSignals),
    recommendedTier: plain.recommendedTier || null,
    recommendedSummary: plain.recommendedSummary || '',
    planChoice: plain.planChoice || {},
    completedAt: plain.completedAt || null
  };
}

const LEGAL_VERSION = process.env.LEGAL_VERSION || '2025-09-15';

const PLAN_PRICING = {
  starter: {
    monthly: 3.99,
    yearly: Math.round(3.99 * 12 * 0.90 * 100) / 100
  },
  premium: {
    monthly: 6.99,
    yearly: Math.round(6.99 * 12 * 0.85 * 100) / 100
  }
};

const STARTER_INTERESTS = new Set([
  'cashflow-clarity',
  'compliance-confidence',
  'document-superpowers',
  'tax-filing-readiness',
  'starter-habits'
]);

const PREMIUM_INTERESTS = new Set([
  'tax-optimisation',
  'equity-planning',
  'net-worth-growth',
  'wealth-lab',
  'ai-copilot'
]);

const VALUE_SIGNAL_WEIGHTS = {
  'roi_savings':      { starter: 2, premium: 1 },
  'roi_tax_relief':   { starter: 1, premium: 2 },
  'roi_timeback':     { starter: 2, premium: 1 },
  'roi_networth':     { starter: 1, premium: 2 },
  'roi_confidence':   { starter: 1, premium: 1 }
};

const TIER_SIGNAL_WEIGHTS = {
  'tier_bank_sync':      { starter: 2 },
  'tier_tax_ai':         { premium: 3 },
  'tier_equity':         { premium: 3 },
  'tier_cashflow':       { starter: 2 },
  'tier_collaboration':  { premium: 2 }
};

function slugify(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function normaliseUsername(value) {
  if (!value) return '';
  const cleaned = String(value).trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  return cleaned.slice(0, 24);
}

async function usernameExists(value, excludeId) {
  if (!value) return false;
  const regex = new RegExp(`^${escapeRegex(value)}$`, 'i');
  const query = { username: { $regex: regex } };
  if (excludeId) query._id = { $ne: excludeId };
  const existing = await User.findOne(query).select({ _id: 1 }).lean();
  return !!existing;
}

async function suggestUsername(base, excludeId) {
  const seed = normaliseUsername(base) || 'member';
  for (let i = 0; i < 20; i += 1) {
    const suffix = Math.floor(100 + Math.random() * 900);
    const candidate = `${seed}${suffix}`.slice(0, 24);
    if (!(await usernameExists(candidate, excludeId))) {
      return candidate;
    }
  }
  return null;
}

function normaliseInterests(list = []) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const result = [];
  list.forEach((item) => {
    const slug = slugify(item);
    if (!slug || seen.has(slug)) return;
    seen.add(slug);
    result.push(slug);
  });
  return result.slice(0, 10);
}

function sanitiseMotivations(list = []) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 6);
}

function weightForResponse(response) {
  if (response === 'yes') return 1;
  if (response === 'not_sure') return 0.5;
  return 0;
}

function computeTierRecommendation({ interests = [], valueSignals = [], tierSignals = [] }) {
  let starterScore = 0;
  let premiumScore = 0;
  const reasons = [];

  interests.forEach((interest) => {
    if (STARTER_INTERESTS.has(interest)) starterScore += 1.5;
    if (PREMIUM_INTERESTS.has(interest)) premiumScore += 2;
  });

  valueSignals.forEach((signal) => {
    const weights = VALUE_SIGNAL_WEIGHTS[signal.id] || { starter: 1, premium: 1 };
    const factor = weightForResponse(signal.response);
    starterScore += (weights.starter || 0) * factor;
    premiumScore += (weights.premium || 0) * factor;
    if (factor > 0.9 && signal.question) reasons.push(signal.question);
  });

  tierSignals.forEach((signal) => {
    const weights = TIER_SIGNAL_WEIGHTS[signal.id] || {};
    const factor = weightForResponse(signal.response);
    starterScore += (weights.starter || 0) * factor;
    premiumScore += (weights.premium || 0) * factor;
    if (factor > 0.9 && signal.question) reasons.push(signal.question);
  });

  const delta = premiumScore - starterScore;
  const tier = delta >= 2 ? 'premium' : 'starter';

  let summary = '';
  if (tier === 'premium') {
    summary = 'Premium unlocks AI-led tax intelligence, equity planning and Scenario Lab automation that map to what you told us.';
  } else {
    summary = 'Starter gets you automated cashflow, document intelligence and nudges to build strong habits right away.';
  }

  return {
    tier,
    summary,
    scores: { starter: Number(starterScore.toFixed(2)), premium: Number(premiumScore.toFixed(2)) },
    reasons: reasons.slice(0, 5)
  };
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + Number(days || 0));
  return d;
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + Number(months || 0));
  return d;
}

function planPrice(tier, interval) {
  const config = PLAN_PRICING[tier] || PLAN_PRICING.starter;
  return interval === 'yearly' ? config.yearly : config.monthly;
}

function inferCardBrand(cardNumber = '') {
  const digits = String(cardNumber);
  if (/^4\d{6,}$/.test(digits)) return 'Visa';
  if (/^5[1-5]\d{5,}$/.test(digits)) return 'Mastercard';
  if (/^3[47]\d{5,}$/.test(digits)) return 'Amex';
  if (/^6(?:011|5)\d{4,}$/.test(digits)) return 'Discover';
  return 'Card';
}

function normalisePlanSelection(plan = {}, recommendation = {}) {
  const selectionRaw = String(plan?.selection || '').toLowerCase();
  const validSelections = ['trial', 'starter', 'premium'];
  const selection = validSelections.includes(selectionRaw) ? selectionRaw : 'trial';
  const intervalRaw = String(plan?.interval || '').toLowerCase();
  const interval = ['yearly', 'annual', 'annually', 'yr', 'y'].includes(intervalRaw) ? 'yearly' : 'monthly';
  const note = plan?.note ? String(plan.note).slice(0, 280) : '';
  const requestedTier = selection === 'premium' ? 'premium' : 'starter';
  return {
    selection,
    interval,
    note,
    requestedTier,
    recommendedTier: recommendation?.tier || null
  };
}

function calculateAge(dob) {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age -= 1;
  return age;
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

function decorateWealth(plan, docInsights = {}) {
  const data = normalisePlanForResponse(plan);
  const aggregates = docInsights.aggregates || {};

  const autoAssets = [];
  if (aggregates.savings?.balance != null) {
    autoAssets.push(normaliseAsset({
      id: 'doc-savings',
      name: 'Savings & ISA (documents)',
      value: Number(aggregates.savings.balance),
      category: 'cash',
      notes: 'Auto-imported from savings and ISA statements.',
    }));
  }
  if (aggregates.pension?.balance != null) {
    autoAssets.push(normaliseAsset({
      id: 'doc-pension',
      name: 'Pension (documents)',
      value: Number(aggregates.pension.balance),
      category: 'pension',
      notes: 'Auto-imported from pension statements.',
    }));
  }

  autoAssets.forEach((asset) => {
    const idx = data.assets.findIndex((item) => item.id === asset.id);
    if (idx >= 0) {
      data.assets[idx] = { ...data.assets[idx], ...asset };
    } else {
      data.assets.push(asset);
    }
  });

  if (!data.contributions || data.contributions.monthly == null) {
    data.contributions = { monthly: 0 };
  }
  if (aggregates.cashflow?.income != null && aggregates.cashflow?.spend != null) {
    const free = Number(aggregates.cashflow.income) - Number(aggregates.cashflow.spend);
    if (free > 0) data.contributions.monthly = Math.round(free);
  }

  if (!data.summary) data.summary = {};
  if (!data.summary.affordability) data.summary.affordability = {};
  if (aggregates.income?.net != null) data.summary.affordability.monthlyIncome = Number(aggregates.income.net);
  if (aggregates.cashflow?.spend != null) data.summary.affordability.monthlySpend = Number(aggregates.cashflow.spend);
  if (aggregates.cashflow?.income != null && aggregates.cashflow?.spend != null) {
    data.summary.affordability.freeCashflow = Number(aggregates.cashflow.income) - Number(aggregates.cashflow.spend);
  }

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
  merged.summary.assetAllocation = Array.isArray(merged.summary.assetAllocation) ? merged.summary.assetAllocation : [];
  merged.summary.liabilitySchedule = Array.isArray(merged.summary.liabilitySchedule)
    ? merged.summary.liabilitySchedule.map((item) => ({
      ...item,
      payoffDate: item?.payoffDate ? new Date(item.payoffDate) : null,
      schedule: Array.isArray(item?.schedule) ? item.schedule : []
    }))
    : [];
  const projections = merged.summary.projections || {};
  merged.summary.projections = {
    horizonMonths: Number(projections.horizonMonths || 0),
    monthly: Array.isArray(projections.monthly) ? projections.monthly : [],
    yearly: Array.isArray(projections.yearly) ? projections.yearly : [],
    assumptions: projections.assumptions || {}
  };
  const affordability = merged.summary.affordability || {};
  const goalScenarios = Array.isArray(affordability.goalScenarios)
    ? affordability.goalScenarios.map((scenario) => ({
      ...scenario,
      targetDate: scenario?.targetDate ? new Date(scenario.targetDate) : null
    }))
    : [];
  merged.summary.affordability = {
    ...affordability,
    monthlyIncome: affordability.monthlyIncome != null ? Number(affordability.monthlyIncome) : null,
    monthlySpend: affordability.monthlySpend != null ? Number(affordability.monthlySpend) : null,
    monthlyContribution: affordability.monthlyContribution != null ? Number(affordability.monthlyContribution) : null,
    debtService: affordability.debtService != null ? Number(affordability.debtService) : null,
    freeCashflow: affordability.freeCashflow != null ? Number(affordability.freeCashflow) : null,
    savingsRateCurrent: affordability.savingsRateCurrent != null ? Number(affordability.savingsRateCurrent) : null,
    recommendedSavingsRate: affordability.recommendedSavingsRate != null ? Number(affordability.recommendedSavingsRate) : null,
    recommendedContribution: affordability.recommendedContribution != null ? Number(affordability.recommendedContribution) : null,
    safeMonthlySavings: affordability.safeMonthlySavings != null ? Number(affordability.safeMonthlySavings) : null,
    goalScenarios,
    advisories: Array.isArray(affordability.advisories) ? affordability.advisories : []
  };
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
  const usage = u.usageStats || {};
  return {
    id: u._id,
    firstName: u.firstName || '',
    lastName: u.lastName || '',
    username: u.username || '',
    email: u.email || '',
    dateOfBirth: u.dateOfBirth || null,
    profileInterests: Array.isArray(u.profileInterests) ? u.profileInterests : [],
    licenseTier: u.licenseTier || 'free',
    roles: Array.isArray(u.roles) ? u.roles : ['user'],
    country: u.country || 'uk',
    emailVerified: !!u.emailVerified,
    subscription: u.subscription || { tier: 'free', status: 'inactive' },
    trial: u.trial || null,
    onboarding: u.onboarding || {},
    onboardingComplete: !!u.onboardingComplete,
    onboardingSurvey: normaliseOnboardingSurvey(u.onboardingSurvey || {}),
    preferences: u.preferences || {},
    usageStats: {
      documentsUploaded: usage.documentsUploaded || 0,
      documentsRequiredMet: usage.documentsRequiredMet || 0,
      documentsRequiredCompleted: usage.documentsRequiredCompleted || 0,
      documentsRequiredTotal: usage.documentsRequiredTotal || 0,
      documentsOutstanding: usage.documentsOutstanding || 0,
      documentsHelpfulMet: usage.documentsHelpfulMet || 0,
      documentsHelpfulTotal: usage.documentsHelpfulTotal || 0,
      documentsAnalyticsMet: usage.documentsAnalyticsMet || 0,
      documentsAnalyticsTotal: usage.documentsAnalyticsTotal || 0,
      documentsProgressUpdatedAt: usage.documentsProgressUpdatedAt || null,
      moneySavedEstimate: usage.moneySavedEstimate || 0,
      moneySavedPrevSpend: usage.moneySavedPrevSpend || 0,
      moneySavedChangePct:
        usage.moneySavedChangePct == null ? null : usage.moneySavedChangePct,
      debtOutstanding: usage.debtOutstanding || 0,
      debtReduced: usage.debtReduced || 0,
      debtReductionDelta: usage.debtReductionDelta || 0,
      netCashFlow: usage.netCashFlow || 0,
      netCashPrev: usage.netCashPrev || 0,
      usageWindowDays: usage.usageWindowDays || 0,
      hmrcFilingsComplete: usage.hmrcFilingsComplete || 0,
      minutesActive: usage.minutesActive || 0,
      updatedAt: usage.updatedAt || null
    },
    salaryNavigator: decorateSalaryNavigator(u.salaryNavigator || {}),
    wealthPlan: decorateWealth(u.wealthPlan || {}, u.documentInsights || {}),
    documentInsights: u.documentInsights || {},
    integrations: u.integrations || [],
    eulaAcceptedAt: u.eulaAcceptedAt || null,
    eulaVersion: u.eulaVersion || null,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt
  };
}

// GET /api/user/username-available?value=<candidate>
router.get('/username-available', auth, async (req, res) => {
  try {
    const raw = typeof req.query.value === 'string' ? req.query.value : '';
    const normalised = normaliseUsername(raw);
    if (!normalised) {
      return res.json({
        available: false,
        normalized: '',
        reason: 'invalid',
        message: 'Usernames must use letters, numbers or underscores.'
      });
    }
    if (normalised.length < 3) {
      return res.json({
        available: false,
        normalized: normalised,
        reason: 'too_short',
        message: 'Usernames must be at least 3 characters.'
      });
    }
    const exists = await usernameExists(normalised, req.user.id);
    let suggestion = null;
    if (exists) {
      suggestion = await suggestUsername(normalised, req.user.id);
    }
    res.json({
      available: !exists,
      normalized: normalised,
      suggestion,
      reason: exists ? 'taken' : 'ok'
    });
  } catch (err) {
    console.error('GET /user/username-available error:', err);
    res.status(500).json({ error: 'Unable to check username' });
  }
});

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
  const trimmedUsername = normaliseUsername(username);
  if (!firstName || !lastName || !email) {
    return res.status(400).json({ error: 'firstName, lastName and email are required' });
  }

  try {
    // Check for unique email/username conflicts (excluding self)
    if (email) {
      const exists = await User.findOne({ email, _id: { $ne: req.user.id } }).lean();
      if (exists) return res.status(400).json({ error: 'Email already in use' });
    }
    if (trimmedUsername) {
      const existsU = await User.findOne({
        _id: { $ne: req.user.id },
        username: { $regex: new RegExp(`^${escapeRegex(trimmedUsername)}$`, 'i') }
      }).lean();
      if (existsU) return res.status(400).json({ error: 'Username already in use' });
    }

    const existing = await User.findById(req.user.id);
    if (!existing) return res.status(404).json({ error: 'User not found' });
    const update = { firstName, lastName, email };
    if (trimmedUsername) update.username = trimmedUsername;
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

// POST /api/user/onboarding/complete
router.post('/onboarding/complete', auth, async (req, res) => {
  try {
    let user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.onboardingComplete) {
      return res.json({ user: publicUser(user) });
    }

    const payload = req.body || {};

    const cleanedUsername = normaliseUsername(payload.username);
    if (!cleanedUsername || cleanedUsername.length < 3) {
      return res.status(400).json({ error: 'Choose a username with at least 3 characters.' });
    }
    if (await usernameExists(cleanedUsername, user._id)) {
      return res.status(400).json({ error: 'Username already in use' });
    }

    const dob = payload.dateOfBirth ? new Date(payload.dateOfBirth) : null;
    if (!dob || Number.isNaN(dob.getTime())) {
      return res.status(400).json({ error: 'Enter a valid date of birth.' });
    }
    const age = calculateAge(dob);
    if (age != null && age < 16) {
      return res.status(400).json({ error: 'You must be at least 16 years old to use Phloat.' });
    }

    const interests = normaliseInterests(payload.interests);
    if (!interests.length) {
      return res.status(400).json({ error: 'Select at least one area you want Phloat to focus on.' });
    }

    const motivations = sanitiseMotivations(payload.motivations || payload.goals);
    const valueSignals = normaliseSurveyAnswers(payload.valueSignals || payload.resonance || []).slice(0, 5);
    const tierSignals = normaliseSurveyAnswers(payload.tierSignals || payload.tierAlignment || []).slice(0, 5);

    if (valueSignals.length < 3 || tierSignals.length < 3) {
      return res.status(400).json({ error: 'Tell us how our value props land so we can tailor the experience.' });
    }

    if (!payload.acceptEula || !payload.acceptPrivacy) {
      return res.status(400).json({ error: 'You must accept the EULA and privacy policy to continue.' });
    }

    const recommendation = computeTierRecommendation({
      interests,
      valueSignals,
      tierSignals
    });

    const planSelection = normalisePlanSelection(payload.plan || {}, recommendation);

    const billing = payload.billing || {};
    const holder = String(billing.holder || billing.cardholderName || '').trim().slice(0, 120);
    const rawNumber = String(billing.cardNumber || '').replace(/[^0-9]/g, '');
    let expMonth = Number(billing.expMonth || billing.expiryMonth || 0);
    let expYear = Number(billing.expYear || billing.expiryYear || 0);
    const expiryRaw = typeof billing.expiry === 'string' ? billing.expiry : '';
    if ((!expMonth || !expYear) && expiryRaw) {
      const match = expiryRaw.match(/^(\d{1,2})\s*\/\s*(\d{2,4})$/);
      if (match) {
        expMonth = Number(match[1]);
        expYear = Number(match[2]);
      }
    }
    if (!holder || holder.length < 3 || rawNumber.length < 12 || !expMonth || !expYear) {
      return res.status(400).json({ error: 'Add billing details so we can activate your workspace.' });
    }
    if (expYear < 100) expYear += 2000;
    if (expMonth < 1 || expMonth > 12) {
      return res.status(400).json({ error: 'Card expiry month looks incorrect.' });
    }
    const expiryDate = new Date(expYear, expMonth, 0);
    if (expiryDate < new Date()) {
      return res.status(400).json({ error: 'The card you entered appears to be expired.' });
    }

    const brand = inferCardBrand(rawNumber);
    const last4 = rawNumber.slice(-4);

    await PaymentMethod.updateMany({ userId: user._id }, { $set: { isDefault: false } });
    let paymentMethod;
    try {
      paymentMethod = await PaymentMethod.create({
        userId: user._id,
        holder,
        brand,
        last4,
        expMonth,
        expYear,
        isDefault: true
      });
    } catch (err) {
      console.error('Failed to capture onboarding payment method', err);
      return res.status(500).json({ error: 'Unable to store billing details right now.' });
    }

    const now = new Date();
    const renewsAt = planSelection.selection === 'trial'
      ? addDays(now, 30)
      : (planSelection.interval === 'yearly' ? addMonths(now, 12) : addMonths(now, 1));
    const trialEndsAt = planSelection.selection === 'trial'
      ? addDays(now, 30)
      : null;

    const resolvedTier = planSelection.selection === 'premium' ? 'premium' : 'starter';
    const subscriptionStatus = planSelection.selection === 'trial' ? 'trial' : 'active';

    const existingOnboarding = user.onboarding?.toObject ? user.onboarding.toObject() : (user.onboarding || {});
    const onboardingState = {
      ...existingOnboarding,
      wizardCompletedAt: existingOnboarding.wizardCompletedAt || now,
      tourCompletedAt: existingOnboarding.tourCompletedAt || now,
      mandatoryCompletedAt: now,
      lastPromptedAt: now,
      goals: motivations.length ? motivations : (existingOnboarding.goals || [])
    };

    const onboardingSurvey = {
      interests,
      motivations,
      valueSignals,
      tierSignals,
      recommendedTier: recommendation.tier,
      recommendedSummary: recommendation.summary,
      planChoice: {
        ...planSelection,
        paymentSnapshot: {
          holder,
          brand,
          last4,
          expMonth,
          expYear,
          capturedAt: paymentMethod?.createdAt || now
        },
        scores: recommendation.scores,
        reasons: recommendation.reasons,
        renewsAt,
        trialEndsAt,
        price: planSelection.selection === 'trial' ? 0 : planPrice(resolvedTier, planSelection.interval)
      },
      completedAt: now
    };

    const trialState = planSelection.selection === 'trial'
      ? { startedAt: now, endsAt: trialEndsAt, coupon: null, requiresPaymentMethod: true }
      : { startedAt: now, endsAt: planSelection.selection === 'premium' ? null : addDays(now, 30), coupon: null, requiresPaymentMethod: false };

    const updateDoc = {
      username: cleanedUsername,
      dateOfBirth: dob,
      profileInterests: interests,
      licenseTier: resolvedTier,
      subscription: {
        tier: resolvedTier,
        status: subscriptionStatus,
        lastPlanChange: now,
        renewsAt
      },
      trial: trialState,
      onboardingSurvey,
      onboardingComplete: true,
      onboarding: onboardingState,
      eulaAcceptedAt: now,
      eulaVersion: LEGAL_VERSION
    };

    user = await User.findByIdAndUpdate(
      user._id,
      { $set: updateDoc },
      { new: true, runValidators: true }
    );

    if (!user) {
      throw new Error('User update failed during onboarding completion');
    }

    try {
      await Subscription.findOneAndUpdate(
        { userId: user._id },
        {
          userId: user._id,
          plan: resolvedTier,
          interval: planSelection.interval,
          price: planSelection.selection === 'trial' ? 0 : planPrice(resolvedTier, planSelection.interval),
          currency: 'GBP',
          status: subscriptionStatus,
          startedAt: now,
          currentPeriodEnd: renewsAt
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    } catch (err) {
      console.warn('Unable to upsert subscription during onboarding', err.message || err);
    }

    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error('POST /user/onboarding/complete error:', err);
    res.status(500).json({ error: 'Unable to complete onboarding right now.' });
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
    res.json({ wealthPlan: decorateWealth(user.wealthPlan, user.documentInsights || {}) });
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
    res.json({ wealthPlan: decorateWealth(user.wealthPlan, user.documentInsights || {}) });
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
    const plan = decorateWealth(user.wealthPlan || {}, user.documentInsights || {});
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
    if (plan.summary?.affordability) {
      const aff = plan.summary.affordability;
      const rateLabel = aff.recommendedSavingsRate != null ? `${Math.round(aff.recommendedSavingsRate * 1000) / 10}%` : '—';
      doc.text(`Recommended savings rate: ${rateLabel}`);
      if (aff.freeCashflow != null) {
        doc.text(`Free cashflow after contributions: ${currency(aff.freeCashflow)}/month`);
      }
    }
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

