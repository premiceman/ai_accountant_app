const catalogue = [
  {
    key: 'payslip',
    label: 'Payslip',
    cadence: { months: 1 },
    why: 'Confirms earnings, tax, NI and pension deductions for salary analytics.',
    where: 'Employer or payroll portal.',
    categories: ['required', 'analytics']
  },
  {
    key: 'current_account_statement',
    label: 'Current account statement',
    cadence: { months: 1 },
    why: 'Used to classify spending, detect recurring commitments and reconcile income.',
    where: 'Download PDF/CSV from your bank portal.',
    categories: ['required', 'analytics']
  },
  {
    key: 'savings_account_statement',
    label: 'Savings account statement',
    cadence: { months: 1 },
    why: 'Tracks savings balances and interest for wealth and tax projections.',
    where: 'Download from savings provider portal.',
    categories: ['analytics', 'helpful']
  },
  {
    key: 'isa_statement',
    label: 'ISA statement',
    cadence: { yearlyBy: '04-30' },
    why: 'Confirms ISA subscriptions, allowances used and investment performance.',
    where: 'ISA provider annual statement or monthly PDF.',
    categories: ['analytics', 'helpful']
  },
  {
    key: 'pension_statement',
    label: 'Pension contribution statement',
    cadence: { yearlyBy: '04-30' },
    why: 'Tracks pension contributions, PIA and balances for tax relief planning.',
    where: 'Workplace or SIPP provider annual statement.',
    categories: ['required', 'helpful']
  },
  {
    key: 'hmrc_correspondence',
    label: 'HMRC correspondence (SA302, statements, coding notices)',
    cadence: { yearlyBy: '01-31' },
    why: 'Evidence for tax lab projections and liabilities.',
    where: 'HMRC online account downloads.',
    categories: ['required']
  },
  {
    key: 'supporting_receipts',
    label: 'Supporting receipts & schedules',
    cadence: { months: 1 },
    why: 'Additional context for deductions and scenario modelling.',
    where: 'Upload scanned receipts or CSV exports.',
    categories: ['helpful']
  }
];

const catalogueByKey = new Map(catalogue.map((item) => [item.key, item]));

const categoryKeys = catalogue.reduce((acc, item) => {
  const cats = Array.isArray(item.categories) && item.categories.length
    ? item.categories
    : ['helpful'];
  for (const cat of cats) {
    const key = String(cat || '').toLowerCase();
    if (!key) continue;
    if (!acc[key]) acc[key] = new Set();
    acc[key].add(item.key);
  }
  return acc;
}, {});

function getCatalogue() {
  return catalogue;
}

function getCatalogueEntry(key) {
  return catalogueByKey.get(String(key || '')) || null;
}

function getKeysByCategory(category) {
  const key = String(category || '').toLowerCase();
  return Array.from(categoryKeys[key] || []);
}

function summarizeCatalogue(perFileInput = {}) {
  const perFile = {};
  if (perFileInput && typeof perFileInput === 'object') {
    for (const [fileId, info] of Object.entries(perFileInput)) {
      if (!info || typeof info !== 'object') continue;
      const key = info.key;
      if (!catalogueByKey.has(key)) continue;
      perFile[fileId] = {
        key,
        collectionId: info.collectionId || null,
        uploadedAt: info.uploadedAt || null,
        name: info.name || null,
        size: Number.isFinite(info.size) ? info.size : Number(info.size) || 0,
        categories: Array.isArray(info.categories) ? info.categories : undefined,
      };
    }
  }

  const perKey = {};
  for (const [fileId, info] of Object.entries(perFile)) {
    const entry = perKey[info.key] || { files: [] };
    entry.files.push({
      id: fileId,
      collectionId: info.collectionId,
      uploadedAt: info.uploadedAt,
      name: info.name,
      size: info.size,
      categories: info.categories,
    });
    perKey[info.key] = entry;
  }

  for (const entry of Object.values(perKey)) {
    entry.files.sort((a, b) => {
      const aDate = a.uploadedAt || '';
      const bDate = b.uploadedAt || '';
      return bDate.localeCompare(aDate);
    });
    entry.latestFileId = entry.files[0]?.id || null;
    entry.latestUploadedAt = entry.files[0]?.uploadedAt || null;
  }

  const categorySummary = {};
  for (const [cat, keys] of Object.entries(categoryKeys)) {
    const list = Array.from(keys);
    const completed = list.filter((key) => perKey[key]?.latestUploadedAt).length;
    categorySummary[cat] = {
      total: list.length,
      completed,
    };
  }

  return {
    perFile,
    perKey,
    categories: categorySummary,
    requiredCompleted: categorySummary.required?.completed || 0,
    helpfulCompleted: categorySummary.helpful?.completed || 0,
    analyticsCompleted: categorySummary.analytics?.completed || 0,
  };
}

module.exports = {
  catalogue,
  getCatalogue,
  getCatalogueEntry,
  getKeysByCategory,
  summarizeCatalogue,
};
