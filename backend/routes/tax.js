// backend/routes/tax.js
// Aggregated tax analytics for the Tax Lab.

const express = require('express');
const dayjs = require('dayjs');

const auth = require('../middleware/auth');
const User = require('../models/User');
const { REQUIRED_DOCUMENTS } = require('../data/documentCatalogue');

const router = express.Router();

router.use(auth);

router.get('/snapshot', async (req, res) => {
  const user = await User.findById(req.user.id).lean();
  if (!user) return res.status(404).json({ error: 'User not found' });

  const hmrc = findHmrcIntegration(user.integrations);
  const meta = hmrc?.metadata || {};

  const docInsights = user.documentInsights || {};
  const docAggregates = docInsights.aggregates || {};
  const allowances = buildAllowances(meta, user, docAggregates);
  const paymentsOnAccount = buildPayments(meta, allowances, docAggregates);
  const obligations = buildObligations(meta, paymentsOnAccount, docAggregates);
  const balances = buildBalances(meta, paymentsOnAccount, docAggregates);
  const documents = buildDocumentsFromCatalogue(user, docInsights);
  const aiPromptSeed = buildAiSeed({
    hmrc,
    user,
    allowances,
    paymentsOnAccount,
    obligations,
    balances,
    documents,
  });

  res.json({
    updatedAt: hmrc?.lastCheckedAt || meta.updatedAt || null,
    integrations: {
      hmrcConnected: hmrc?.status === 'connected',
      lastSync: hmrc?.lastCheckedAt || null,
    },
    personalTaxCode: {
      code: meta.taxCode || user.salaryNavigator?.taxSummary?.taxCode || '1257L',
      source: meta.taxCode ? 'hmrc' : 'derived',
      updatedAt: meta.taxCodeUpdatedAt || hmrc?.lastCheckedAt || null,
    },
    hmrcBalances: balances,
    allowances,
    paymentsOnAccount,
    obligations,
    documents,
    aiPromptSeed,
    quickActions: buildQuickActions({
      allowances,
      paymentsOnAccount,
      obligations,
      balances,
    }),
  });
});

router.get('/scenarios', async (req, res) => {
  const user = await User.findById(req.user.id).lean();
  if (!user) return res.status(404).json({ error: 'User not found' });

  const hmrc = findHmrcIntegration(user.integrations);
  const meta = hmrc?.metadata || {};
  const allowances = buildAllowances(meta, user);
  const paymentsOnAccount = buildPayments(meta, allowances);

  res.json({
    baseline: buildBaseline(meta, paymentsOnAccount),
    deltas: buildScenarioDeltas(meta, allowances, paymentsOnAccount),
  });
});

module.exports = router;

// --------------------------- helpers ---------------------------

function findHmrcIntegration(integrations) {
  if (!Array.isArray(integrations)) return null;
  return integrations.find((item) => (item?.key || '').toLowerCase() === 'hmrc') || null;
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function pct(used, total) {
  const t = toNumber(total, 0);
  if (!t) return 0;
  return Math.min(100, Math.round((toNumber(used, 0) / t) * 100));
}

function buildAllowances(meta, user, docAggregates = {}) {
  const sourceArray = Array.isArray(meta.allowances) ? meta.allowances : null;
  const sourceObject = !sourceArray && meta.gauges && typeof meta.gauges === 'object' ? meta.gauges : null;
  const navigator = user?.salaryNavigator?.taxSummary?.gauges || {};

  const defaults = [
    { key: 'personalAllowance', label: 'Personal allowance', total: 12570 },
    { key: 'dividendAllowance', label: 'Dividend allowance', total: 500 },
    { key: 'cgtAllowance', label: 'Capital gains annual exempt amount', total: 3000 },
    { key: 'pensionAnnual', label: 'Pension annual allowance', total: 60000 },
    { key: 'isa', label: 'ISA subscription limit', total: 20000 },
  ];

  const allowances = [];
  if (sourceArray) {
    sourceArray.forEach((item) => {
      allowances.push(normaliseAllowance(item));
    });
  } else if (sourceObject) {
    Object.entries(sourceObject).forEach(([key, value]) => {
      allowances.push(normaliseAllowance({ key, label: prettifyKey(key), ...value }));
    });
  } else {
    Object.entries(navigator).forEach(([key, value]) => {
      allowances.push(normaliseAllowance({ key, label: prettifyKey(key), ...value }));
    });
  }

  const knownKeys = new Set(allowances.map((a) => a.key));
  defaults.forEach((item) => {
    if (knownKeys.has(item.key)) return;
    allowances.push(normaliseAllowance(item));
  });

  const pensionAllow = allowances.find((a) => a.key === 'pensionAnnual');
  if (pensionAllow && docAggregates.pension?.contributions != null) {
    pensionAllow.used = toNumber(docAggregates.pension.contributions, pensionAllow.used);
  }

  const isaAllow = allowances.find((a) => a.key === 'isa');
  if (isaAllow && docAggregates.savings?.balance != null) {
    isaAllow.used = Math.min(toNumber(isaAllow.total, isaAllow.total), toNumber(docAggregates.savings.balance));
  }

  return allowances
    .map((item) => {
      const used = toNumber(item.used, 0);
      const total = toNumber(item.total, 0);
      const remaining = Math.max(0, total - used);
      return {
        key: item.key,
        label: item.label,
        used,
        total,
        remaining,
        percentUsed: pct(used, total),
        status: allowanceStatus(used, total),
        updatedAt: item.updatedAt || meta.updatedAt || null,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

function normaliseAllowance(item) {
  return {
    key: item.key || slugify(item.label || 'allowance'),
    label: item.label || prettifyKey(item.key || 'Allowance'),
    used: toNumber(item.used, 0),
    total: toNumber(item.total, 0),
    updatedAt: item.updatedAt || null,
  };
}

function allowanceStatus(used, total) {
  const u = toNumber(used, 0);
  const t = toNumber(total, 0);
  if (!t) return 'info';
  const ratio = t ? u / t : 0;
  if (ratio >= 1) return 'exhausted';
  if (ratio >= 0.85) return 'attention';
  if (ratio >= 0.5) return 'tracking';
  return 'available';
}

function prettifyKey(key) {
  if (!key) return 'Allowance';
  return String(key)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function slugify(label) {
  return String(label || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    || 'item';
}

function buildPayments(meta, allowances, docAggregates = {}) {
  const payments = Array.isArray(meta.paymentsOnAccount) ? meta.paymentsOnAccount : [];
  if (payments.length) {
    return payments.map((item) => ({
      reference: item.reference || item.period || null,
      dueDate: normaliseDate(item.dueDate),
      amount: toNumber(item.amount, item.value),
      status: item.status || 'due',
      note: item.note || item.description || null,
    })).sort(byDueDate);
  }

  if (docAggregates.tax?.taxDue != null && docAggregates.tax.taxDue > 0) {
    const jan = upcomingDueDate(0, 31, 1);
    return [{
      reference: `${taxYearLabel(jan)} Balance`,
      dueDate: jan,
      amount: Math.round(Number(docAggregates.tax.taxDue)),
      status: 'due',
      note: 'Balance due inferred from HMRC correspondence upload.',
    }];
  }

  const personal = allowances.find((a) => a.key === 'personalAllowance');
  const baseline = toNumber(meta?.kpis?.hmrc?.estTaxAnnual, toNumber(meta.estimatedTax, 0));
  const estimate = baseline > 0 ? baseline / 2 : Math.max(0, toNumber(meta.expectedPaymentOnAccount, 0));

  const jan = upcomingDueDate(0, 31, 1); // 31 January
  const jul = upcomingDueDate(6, 31, 2); // 31 July (month index 6 => July)

  return [
    {
      reference: `${taxYearLabel(jan)} POA 1`,
      dueDate: jan,
      amount: Math.round(estimate || Math.max(0, (personal?.used || 0) * 0.4)),
      status: 'projected',
      note: 'First payment on account for the current tax year.',
    },
    {
      reference: `${taxYearLabel(jul)} POA 2`,
      dueDate: jul,
      amount: Math.round(estimate || Math.max(0, (personal?.used || 0) * 0.4)),
      status: 'projected',
      note: 'Second payment on account for the current tax year.',
    },
  ];
}

function buildObligations(meta, payments, docAggregates = {}) {
  const obligations = Array.isArray(meta.obligations) ? meta.obligations : [];
  if (obligations.length) {
    return obligations
      .map((item) => ({
        label: item.label || item.title || prettifyKey(item.type || 'obligation'),
        dueDate: normaliseDate(item.dueDate || item.deadline),
        status: item.status || 'due',
        period: item.period || null,
        type: item.type || 'filing',
        note: item.note || item.description || null,
      }))
      .sort(byDueDate);
  }

  const filingDate = upcomingDueDate(0, 31, 1); // 31 January filing
  const paymentsMapped = payments.map((p) => ({
    label: 'Payment on account',
    dueDate: p.dueDate,
    status: p.status,
    period: p.reference,
    type: 'payment',
    note: p.note,
  }));

  if (docAggregates.tax?.taxDue != null && docAggregates.tax.taxDue > 0) {
    paymentsMapped.push({
      label: 'Balance due',
      dueDate: paymentsMapped[0]?.dueDate || filingDate,
      status: 'due',
      period: taxYearLabel(paymentsMapped[0]?.dueDate || filingDate),
      type: 'payment',
      note: 'Generated from HMRC correspondence upload.',
    });
  }

  return [
    {
      label: 'Submit Self Assessment return',
      dueDate: filingDate,
      status: 'due',
      period: taxYearLabel(filingDate),
      type: 'filing',
      note: 'Online filing deadline for the previous tax year.',
    },
    ...paymentsMapped,
  ].sort(byDueDate);
}

function buildBalances(meta, payments, docAggregates = {}) {
  const sa = meta.balances?.selfAssessment || {};
  let net = toNumber(sa.net, meta?.kpis?.hmrc?.netForRange || 0);
  if (!net && docAggregates.tax?.taxDue != null) {
    net = Number(docAggregates.tax.taxDue);
  }
  const debit = Math.max(0, toNumber(sa.debit, net > 0 ? net : 0));
  const credit = Math.max(0, toNumber(sa.credit, net < 0 ? Math.abs(net) : 0));
  const label = sa.label || meta?.kpis?.hmrc?.label || (net > 0 ? 'Amount due to HMRC' : net < 0 ? 'HMRC owes you' : 'Settled');

  const breakdown = Array.isArray(sa.breakdown)
    ? sa.breakdown.map((item) => ({
        reference: item.reference || item.label || null,
        amount: toNumber(item.amount, 0),
        dueDate: normaliseDate(item.dueDate),
        status: item.status || 'due',
      }))
    : payments.map((p) => ({ reference: p.reference, amount: p.amount, dueDate: p.dueDate, status: p.status }));

  return {
    net,
    debit,
    credit,
    label,
    updatedAt: sa.updatedAt || meta.updatedAt || null,
    breakdown,
  };
}

function buildDocumentsFromCatalogue(user, docInsights = {}) {
  const catalogue = user?.usageStats?.documentsCatalogue?.perKey || {};
  return REQUIRED_DOCUMENTS.map((doc) => {
    const entry = catalogue[doc.key] || {};
    const latest = entry.latestUploadedAt || entry.updatedAt || null;
    const uploadedCount = Array.isArray(entry.files) ? entry.files.length : 0;
    const fresh = isDocumentFresh(doc.cadence, latest);
    return {
      key: doc.key,
      label: doc.label,
      required: true,
      lastUploadedAt: latest,
      uploadedCount,
      status: fresh ? 'complete' : latest ? 'stale' : 'missing',
      sourceNote: docInsights.sources?.[doc.key]?.files?.map((f) => f.name).join(', ') || null,
    };
  });
}

function isDocumentFresh(cadence, uploadedAt) {
  if (!uploadedAt) return false;
  const uploaded = dayjs(uploadedAt);
  if (!uploaded.isValid()) return false;
  const now = dayjs();
  if (cadence?.adhoc) return true;
  if (cadence?.months) {
    return uploaded.add(cadence.months, 'month').isAfter(now);
  }
  if (cadence?.yearlyBy) {
    const [monthStr, dayStr] = String(cadence.yearlyBy).split('-');
    const month = Number(monthStr) - 1;
    const day = Number(dayStr);
    let due = dayjs().month(month >= 0 ? month : 0).date(day || 1);
    if (due.isBefore(uploaded)) due = uploaded.add(1, 'year');
    if (now.isAfter(due)) {
      return uploaded.isAfter(due.subtract(1, 'year'));
    }
    return uploaded.add(1, 'year').isAfter(due);
  }
  return false;
}

function buildAiSeed({ hmrc, allowances, paymentsOnAccount, obligations, balances, documents }) {
  const lines = [];
  if (hmrc?.status === 'connected') {
    lines.push('HMRC integration: connected');
    if (hmrc.lastCheckedAt) lines.push(`Last sync: ${new Date(hmrc.lastCheckedAt).toISOString()}`);
  } else {
    lines.push('HMRC integration: not connected (using estimates)');
  }
  if (balances) {
    lines.push(`HMRC net position: £${toNumber(balances.net, 0).toLocaleString('en-GB', { maximumFractionDigits: 0 })}`);
  }
  if (allowances?.length) {
    const top = allowances
      .slice()
      .sort((a, b) => b.percentUsed - a.percentUsed)
      .slice(0, 5)
      .map((a) => `${a.label}: ${a.percentUsed}% used`);
    lines.push('Allowances snapshot:');
    lines.push(...top.map((s) => `- ${s}`));
  }
  if (paymentsOnAccount?.length) {
    lines.push('Payments on account:');
    paymentsOnAccount.forEach((p) => {
      lines.push(`- ${p.reference || 'Payment'} £${toNumber(p.amount, 0).toLocaleString('en-GB', { maximumFractionDigits: 0 })} due ${formatDate(p.dueDate)}`);
    });
  }
  if (obligations?.length) {
    const next = obligations[0];
    if (next) {
      lines.push(`Next obligation: ${next.label} due ${formatDate(next.dueDate)}`);
    }
  }
  const outstandingDocs = (documents || []).filter((doc) => doc.status !== 'complete');
  if (outstandingDocs.length) {
    lines.push('Evidence gaps: ' + outstandingDocs.map((d) => d.label).join(', '));
  }
  return lines.join('\n');
}

function buildQuickActions({ allowances, paymentsOnAccount, obligations, balances }) {
  const nextDue = obligations?.[0];
  const remainingDividend = allowances?.find((a) => a.key === 'dividendAllowance');
  const pension = allowances?.find((a) => a.key === 'pensionAnnual');
  const netLabel = balances?.label || 'HMRC position';

  return [
    {
      id: 'poa-cover',
      label: 'Will my payments on account cover the bill?',
      prompt: `Review my current HMRC position (${netLabel}) and payments on account to confirm whether they are enough to cover the upcoming balancing payment. Highlight any shortfall and actions to close it.`,
    },
    {
      id: 'allowance-plan',
      label: 'Plan allowance usage before year end',
      prompt: `Given the allowance usage (${formatAllowancePrompt(allowances)}), outline the most impactful actions I should take before tax year end to stay tax efficient.`,
    },
    {
      id: 'deadline-prep',
      label: `Prepare for ${nextDue ? formatDate(nextDue.dueDate) : 'my next deadline'}`,
      prompt: `Create a preparation checklist for the upcoming obligation "${nextDue ? nextDue.label : 'Self Assessment'}" including payments on account (${formatPaymentsPrompt(paymentsOnAccount)}) and any evidence to gather.`,
    },
    {
      id: 'pension-scenario',
      label: 'Compare extra pension contributions',
      prompt: `Use the snapshot to assess the impact of contributing an extra £2,000 into my pension${pension ? ` (remaining allowance £${Math.max(0, toNumber(pension.remaining, 0)).toLocaleString('en-GB')})` : ''}. Quantify tax relief and updated take-home.`,
    },
  ];
}

function formatAllowancePrompt(allowances = []) {
  if (!allowances.length) return 'no allowance data';
  return allowances
    .map((a) => `${a.label} ${a.percentUsed}% used`)
    .join('; ');
}

function formatPaymentsPrompt(payments = []) {
  if (!payments.length) return 'no scheduled payments';
  return payments
    .map((p) => `${p.reference || 'Payment'} £${toNumber(p.amount, 0).toLocaleString('en-GB')} due ${formatDate(p.dueDate)}`)
    .join('; ');
}

function buildBaseline(meta, payments) {
  const baseline = meta.scenarioBaseline || {};
  const totalTax = toNumber(baseline.totalTax, meta?.kpis?.hmrc?.estTaxAnnual || meta.estimatedTax || 0);
  const takeHome = toNumber(baseline.takeHome, meta.takeHome || 0);
  const description = baseline.description || meta.baselineDescription || 'Current HMRC projection based on synced data.';
  const due = payments?.[0];
  return {
    label: baseline.label || 'Current projection',
    totalTax,
    takeHome,
    description: due ? `${description} Next due: ${formatDate(due.dueDate)}.` : description,
  };
}

function buildScenarioDeltas(meta, allowances, payments) {
  const scenarios = Array.isArray(meta.scenarios) ? meta.scenarios : [];
  if (scenarios.length) {
    return scenarios.map((item) => ({
      id: item.id || slugify(item.label || item.name || 'scenario'),
      label: item.label || item.name || 'Scenario',
      summary: item.summary || item.description || null,
      taxDelta: toNumber(item.taxDelta, item.delta?.tax),
      takeHomeDelta: toNumber(item.takeHomeDelta, item.delta?.takeHome),
      allowanceImpact: item.allowanceImpact || item.delta?.allowances || null,
    }));
  }

  const dividend = allowances.find((a) => a.key === 'dividendAllowance');
  const cgt = allowances.find((a) => a.key === 'cgtAllowance');
  const pension = allowances.find((a) => a.key === 'pensionAnnual');
  const payment = payments?.[0];

  return [
    {
      id: 'dividend-top-up',
      label: 'Use remaining dividend allowance',
      summary: dividend
        ? `Model taking dividends to fill the remaining £${Math.max(0, dividend.remaining).toLocaleString('en-GB')} allowance.`
        : 'Model topping up dividends within the basic allowance.',
      taxDelta: dividend ? Math.round(Math.max(0, dividend.remaining) * 0.075) : 0,
      takeHomeDelta: dividend ? Math.round(Math.max(0, dividend.remaining) * 0.925) : 0,
      allowanceImpact: { key: dividend?.key || 'dividendAllowance', remainingAfter: Math.max(0, (dividend?.remaining || 0) - (dividend?.remaining || 0)) },
    },
    {
      id: 'bed-and-isa',
      label: 'Harvest gains and shelter in ISA',
      summary: cgt
        ? `Compare realising £${Math.max(0, Math.min(cgt.remaining, 3000)).toLocaleString('en-GB')} in gains and re-buying within the ISA.`
        : 'Compare crystallising gains and moving into ISA to avoid future CGT.',
      taxDelta: cgt ? -Math.round(Math.max(0, Math.min(cgt.remaining, 3000)) * 0.1) : -300,
      takeHomeDelta: cgt ? 0 : 0,
      allowanceImpact: { key: cgt?.key || 'cgtAllowance', remainingAfter: Math.max(0, (cgt?.remaining || 0) - Math.min(cgt?.remaining || 0, 3000)) },
    },
    {
      id: 'pension-boost',
      label: 'Add £2k pension contribution',
      summary: pension
        ? `Evaluate adding £2,000 gross to pension (${Math.max(0, pension.remaining).toLocaleString('en-GB')} allowance remaining).`
        : 'Evaluate extra £2,000 pension contribution and relief.',
      taxDelta: -800,
      takeHomeDelta: -1200,
      allowanceImpact: { key: pension?.key || 'pensionAnnual', remainingAfter: Math.max(0, (pension?.remaining || 0) - 2000) },
    },
    {
      id: 'poa-shortfall',
      label: 'Catch up a payment on account shortfall',
      summary: payment
        ? `Quantify topping up the ${payment.reference || 'next payment'} due ${formatDate(payment.dueDate)} if the estimate increases by £1,500.`
        : 'Quantify the impact of HMRC increasing the payment on account requirement by £1,500.',
      taxDelta: 1500,
      takeHomeDelta: -1500,
      allowanceImpact: null,
    },
  ];
}

function normaliseDate(date) {
  if (!date) return null;
  const d = dayjs(date);
  if (!d.isValid()) return null;
  return d.toISOString();
}

function byDueDate(a, b) {
  const ad = a?.dueDate ? new Date(a.dueDate).getTime() : Infinity;
  const bd = b?.dueDate ? new Date(b.dueDate).getTime() : Infinity;
  return ad - bd;
}

function upcomingDueDate(monthIndex, day, offset) {
  const now = dayjs();
  let due = dayjs().month(monthIndex).date(day);
  if (due.isBefore(now)) due = due.add(offset || 1, 'year');
  return due.toISOString();
}

function taxYearLabel(dateIso) {
  const d = dayjs(dateIso);
  const year = d.month() >= 3 ? d.year() : d.year() - 1; // tax year starts 6 April
  return `${year}/${String(year + 1).slice(-2)}`;
}

function formatDate(dateIso) {
  if (!dateIso) return '—';
  const d = dayjs(dateIso);
  if (!d.isValid()) return '—';
  return d.format('D MMM YYYY');
}
