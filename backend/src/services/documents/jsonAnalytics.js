'use strict';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  let str = trimmed;
  let negative = false;
  if (str.startsWith('(') && str.endsWith(')')) {
    negative = true;
    str = str.slice(1, -1);
  }
  str = str.replace(/[£$,]/g, '');
  const match = str.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -Math.abs(parsed) : parsed;
}

function normaliseLineItems(list, { absolute = false } = {}) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const label = item.label || item.rawLabel || item.name || item.category || 'Item';
      const amount = toNumber(
        item.amount
        ?? item.amountPeriod
        ?? item.value
        ?? item.total
        ?? item.moneyIn
        ?? item.moneyOut
      );
      if (amount == null) return null;
      return {
        label,
        category: item.category || item.type || label,
        amount: absolute ? Math.abs(amount) : amount,
        amountRaw: amount,
        amountYtd: toNumber(item.amountYtd ?? item.amountYearToDate ?? item.ytd),
      };
    })
    .filter(Boolean);
}

function extractVaultData(metadata) {
  if (!isPlainObject(metadata)) return {};
  if (isPlainObject(metadata.data)) return metadata.data;
  if (isPlainObject(metadata.document)) return metadata.document;
  if (isPlainObject(metadata.standardised)) return metadata.standardised;
  if (isPlainObject(metadata.standardized)) return metadata.standardized;
  return metadata;
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  const str = String(value).trim();
  if (!str) return null;
  const isoCandidate = new Date(str);
  if (!Number.isNaN(isoCandidate.getTime())) {
    return isoCandidate.toISOString();
  }
  const monthMatch = str.match(/^(\d{2})\/(\d{4})$/);
  if (monthMatch) {
    const month = Number(monthMatch[1]);
    const year = Number(monthMatch[2]);
    if (month >= 1 && month <= 12 && year >= 1900) {
      const start = new Date(Date.UTC(year, month - 1, 1));
      return start.toISOString();
    }
  }
  const altMatch = str.match(/^(\d{4})-(\d{2})$/);
  if (altMatch) {
    const start = new Date(Date.UTC(Number(altMatch[1]), Number(altMatch[2]) - 1, 1));
    return start.toISOString();
  }
  const fallback = str.match(/^(\d{2})[\/-](\d{2})[\/-](\d{2,4})$/);
  if (fallback) {
    const day = Number(fallback[1]);
    const month = Number(fallback[2]);
    let year = Number(fallback[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return null;
}

function deriveMonthKey(value) {
  if (!value) return null;
  const str = String(value).trim();
  if (!str) return null;
  const mmYyyy = str.match(/^(\d{2})\/(\d{4})$/);
  if (mmYyyy) {
    return `${mmYyyy[2]}-${mmYyyy[1]}`;
  }
  const isoMonth = str.match(/^(\d{4})-(\d{2})$/);
  if (isoMonth) {
    return `${isoMonth[1]}-${isoMonth[2]}`;
  }
  const isoDate = parseDate(str);
  if (isoDate) {
    const match = isoDate.match(/^(\d{4})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}`;
  }
  return null;
}

function buildPeriodFromMonthKey(monthKey) {
  if (!monthKey) return { monthKey: null, label: null, start: null, end: null };
  const [yearStr, monthStr] = monthKey.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr) - 1;
  if (!Number.isInteger(year) || Number.isNaN(month) || month < 0 || month > 11) {
    return { monthKey, label: monthKey, start: null, end: null };
  }
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
  return {
    monthKey,
    label: start.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }),
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

function firstNonNull(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return null;
}

function normaliseTransaction(tx) {
  if (!tx || typeof tx !== 'object') return null;
  const moneyIn = toNumber(tx.moneyIn ?? tx.in ?? tx.credit);
  const moneyOut = toNumber(tx.moneyOut ?? tx.out ?? tx.debit);
  const amountCandidate = toNumber(tx.amount ?? tx.value ?? tx.total ?? tx.balanceImpact);
  let amount = null;
  if (moneyIn != null && moneyIn !== 0) amount = Math.abs(moneyIn);
  else if (moneyOut != null && moneyOut !== 0) amount = -Math.abs(moneyOut);
  else if (amountCandidate != null) amount = amountCandidate;
  if (amount == null || amount === 0) return null;

  const directionRaw = String(tx.direction || '').toLowerCase();
  const direction = amount < 0 ? 'outflow' : amount > 0 ? 'inflow' : (directionRaw === 'outflow' ? 'outflow' : 'inflow');
  const signedAmount = direction === 'outflow' ? -Math.abs(amount) : Math.abs(amount);
  const date = firstNonNull(tx.date, tx.transactionDate, tx.postedDate, tx.bookingDate, tx.valueDate);

  return {
    id: tx.id || tx.reference || null,
    description: tx.description || tx.narrative || tx.merchant || 'Transaction',
    category: tx.category || tx.type || tx.group || 'Other',
    amount: signedAmount,
    direction,
    date: parseDate(date) || null,
    accountId: tx.accountId || null,
    accountName: tx.accountName || null,
    bankName: tx.bankName || null,
    accountType: tx.accountType || null,
    transfer: Boolean(tx.transfer) || String(tx.category || '').toLowerCase() === 'transfers',
  };
}

function collectTransactionsFromData(data) {
  if (!isPlainObject(data)) return [];
  const candidates = [];
  if (Array.isArray(data.transactions)) candidates.push(data.transactions);
  if (isPlainObject(data.statement) && Array.isArray(data.statement.transactions)) {
    candidates.push(data.statement.transactions);
  }
  if (isPlainObject(data.accounts)) {
    Object.values(data.accounts).forEach((account) => {
      if (Array.isArray(account?.transactions)) candidates.push(account.transactions);
    });
  }
  for (const list of candidates) {
    if (Array.isArray(list) && list.length) {
      return list.map((tx) => normaliseTransaction(tx)).filter(Boolean);
    }
  }
  return [];
}

function deriveAccountInfo(data) {
  if (!isPlainObject(data)) return null;
  const account = data.account
    || data.accounts?.primary
    || data.statement?.account
    || data.statement?.accounts?.primary
    || null;
  if (!isPlainObject(account)) return null;
  return {
    accountId: account.accountId || account.id || null,
    accountName: account.accountName || account.name || null,
    bankName: account.bankName || account.institution || null,
    accountType: account.accountType || account.type || null,
    accountNumberMasked: account.accountNumberMasked || account.accountNumber || null,
  };
}

function summarisePayslip(entry) {
  const data = extractVaultData(entry?.metadata);
  if (!isPlainObject(data)) return null;

  const period = isPlainObject(data.period) ? data.period : {};
  const monthLabel = firstNonNull(
    period.Date,
    period.date,
    period.month,
    entry?.metadata?.documentMonthLabel,
  );
  const monthKey = deriveMonthKey(monthLabel)
    || deriveMonthKey(entry?.metadata?.documentMonth)
    || deriveMonthKey(period.end || period.start);
  const { start, end, label } = buildPeriodFromMonthKey(monthKey);

  const payDate = parseDate(firstNonNull(period.payDate, period.endDate, period.end, entry?.metadata?.documentDate));
  const totals = isPlainObject(data.totals) ? data.totals : {};
  const gross = toNumber(firstNonNull(totals.grossPeriod, totals.gross, totals.totalGross));
  const net = toNumber(firstNonNull(totals.netPeriod, totals.net, totals.totalNet));
  const grossYtd = toNumber(firstNonNull(totals.grossYtd, totals.grossYearToDate));
  const netYtd = toNumber(firstNonNull(totals.netYtd, totals.netYearToDate));

  const earnings = normaliseLineItems(data.earnings);
  const deductions = normaliseLineItems(data.deductions, { absolute: true });
  const allowances = normaliseLineItems(data.allowances || data.benefits);

  const deductionLookup = new Map(
    deductions.map((item) => [String(item.category || item.label || '').toLowerCase(), item.amountRaw])
  );

  const tax = toNumber(firstNonNull(
    totals.tax,
    totals.incomeTax,
    data.tax,
    data.incomeTax,
    deductionLookup.get('income_tax'),
    deductionLookup.get('income tax'),
    deductionLookup.get('tax')
  ));

  const ni = toNumber(firstNonNull(
    totals.nationalInsurance,
    totals.ni,
    data.nationalInsurance,
    deductionLookup.get('national_insurance'),
    deductionLookup.get('national insurance')
  ));

  const pension = toNumber(firstNonNull(
    totals.pension,
    totals.pensionContribution,
    data.pension,
    deductionLookup.get('pension'),
    deductionLookup.get('pension_employee')
  ));

  const studentLoan = toNumber(firstNonNull(
    totals.studentLoan,
    data.studentLoan,
    deductionLookup.get('student_loan'),
    deductionLookup.get('student loan')
  ));

  const totalDeductionsCandidate = toNumber(firstNonNull(
    totals.totalDeductions,
    totals.deductionsTotal,
    data.totalDeductions,
    data.deductionsTotal,
  ));
  const totalDeductions = totalDeductionsCandidate != null
    ? totalDeductionsCandidate
    : deductions.reduce((acc, item) => acc + (item.amountRaw || 0), 0);

  const payFrequency = firstNonNull(period.payFrequency, data.payFrequency, entry?.metadata?.payFrequency);
  const taxCode = firstNonNull(
    data.employee?.taxCode,
    data.employee?.taxCodeCurrent,
    entry?.metadata?.taxCode,
  );
  const employerName = firstNonNull(data.employer?.name, entry?.metadata?.employerName);

  const takeHomePercent = gross ? (net ?? 0) / gross : null;

  return {
    monthKey,
    monthLabel: monthLabel || (monthKey ? monthKey.slice(5) + '/' + monthKey.slice(0, 4) : null),
    period: {
      label: monthLabel || label,
      start,
      end,
      payDate,
    },
    sortKey: payDate || end || start || null,
    metrics: {
      gross,
      grossYtd,
      net,
      netYtd,
      tax,
      ni,
      pension,
      studentLoan,
      totalDeductions,
      takeHomePercent: takeHomePercent != null && Number.isFinite(takeHomePercent) ? takeHomePercent : null,
      payFrequency: payFrequency || null,
      taxCode: taxCode || null,
      employerName: employerName || null,
      payDate: payDate || null,
      periodStart: parseDate(firstNonNull(period.start, period.startDate)) || start,
      periodEnd: parseDate(firstNonNull(period.end, period.endDate)) || end,
      source: 'vault-json',
    },
    earnings: earnings.map((item) => ({ label: item.label, amount: item.amount, amountYtd: item.amountYtd })),
    deductions: deductions.map((item) => ({ label: item.label, amount: item.amount, amountYtd: item.amountYtd })),
    allowances: allowances.map((item) => ({ label: item.label, amount: item.amount, amountYtd: item.amountYtd })),
  };
}

function summariseStatement(entry) {
  const data = extractVaultData(entry?.metadata);
  const transactions = collectTransactionsFromData(data);
  const fallbackTransactions = Array.isArray(entry?.transactions)
    ? entry.transactions.map((tx) => normaliseTransaction(tx)).filter(Boolean)
    : [];
  const normalisedTransactions = transactions.length ? transactions : fallbackTransactions;
  if (!normalisedTransactions.length) {
    return null;
  }

  const periodSource = isPlainObject(data.statement?.period)
    ? data.statement.period
    : isPlainObject(data.period)
      ? data.period
      : entry?.metadata?.period || {};

  const monthLabel = firstNonNull(periodSource?.Date, periodSource?.date, periodSource?.month, entry?.metadata?.documentMonthLabel);
  const monthKey = deriveMonthKey(monthLabel) || deriveMonthKey(periodSource?.end || periodSource?.start);
  const { start, end, label } = buildPeriodFromMonthKey(monthKey);
  const account = deriveAccountInfo(data.statement || data);

  return {
    monthKey,
    period: {
      label: monthLabel || label,
      start: parseDate(firstNonNull(periodSource?.start, periodSource?.startDate)) || start,
      end: parseDate(firstNonNull(periodSource?.end, periodSource?.endDate)) || end,
    },
    transactions: normalisedTransactions,
    account,
    sortKey: (parseDate(periodSource?.end) || parseDate(periodSource?.start) || end),
  };
}

function summariseSavings(entry) {
  const data = extractVaultData(entry?.metadata);
  if (!isPlainObject(data)) return null;
  const balance = toNumber(firstNonNull(
    data.balance,
    data.closingBalance,
    data.summary?.balance,
    data.summary?.closingBalance,
    data.totals?.balance,
    data.totals?.closingBalance,
  ));
  const interest = toNumber(firstNonNull(
    data.interest,
    data.interestOrDividends,
    data.summary?.interest,
    data.totals?.interest,
  ));
  if (balance == null && interest == null) return null;
  return {
    balance,
    interest,
    sortKey: parseDate(entry?.metadata?.documentDate) || entry?.files?.[0]?.uploadedAt || null,
  };
}

function summarisePension(entry) {
  const data = extractVaultData(entry?.metadata);
  if (!isPlainObject(data)) return null;
  const balance = toNumber(firstNonNull(
    data.balance,
    data.planValue,
    data.totals?.balance,
    data.summary?.balance,
    data.totalValue,
  ));
  const contributions = toNumber(firstNonNull(
    data.contributions,
    data.employeeContributions,
    data.summary?.contributions,
    data.totals?.contributions,
  ));
  if (balance == null && contributions == null) return null;
  return {
    balance,
    contributions,
    sortKey: parseDate(entry?.metadata?.documentDate) || entry?.files?.[0]?.uploadedAt || null,
  };
}

function summariseHmrc(entry) {
  const data = extractVaultData(entry?.metadata);
  if (!isPlainObject(data)) return null;
  const taxDue = toNumber(firstNonNull(
    data.taxDue,
    data.taxBalance,
    data.balanceOutstanding,
    data.amountDue,
  ));
  if (taxDue == null) return null;
  return {
    taxDue,
    sortKey: parseDate(entry?.metadata?.documentDate) || entry?.files?.[0]?.uploadedAt || null,
  };
}

function summariseStatementCollections(statementSummaries) {
  const transactions = [];
  const accounts = new Map();
  let transferCount = 0;

  statementSummaries.forEach((summary) => {
    if (!summary) return;
    summary.transactions.forEach((tx, idx) => {
      if (!tx) return;
      const id = `${summary.monthKey || 'unknown'}:${idx}`;
      if (tx.transfer) transferCount += 1;
      const accountId = tx.accountId || summary.account?.accountId || 'account';
      const accountName = tx.accountName || summary.account?.accountName || 'Account';
      const accountKey = `${accountId}|${accountName}`;
      if (!accounts.has(accountKey)) {
        accounts.set(accountKey, {
          accountId,
          accountName,
          bankName: tx.bankName || summary.account?.bankName || null,
          accountType: tx.accountType || summary.account?.accountType || null,
          accountNumberMasked: summary.account?.accountNumberMasked || null,
          period: summary.period || null,
          totals: { income: 0, spend: 0 },
        });
      }
      const summaryAccount = accounts.get(accountKey);
      const amount = tx.amount;
      transactions.push({ ...tx, __id: id });
      if (amount >= 0) summaryAccount.totals.income += amount;
      else summaryAccount.totals.spend += Math.abs(amount);
    });
  });

  const totals = transactions.reduce((acc, tx) => {
    if (tx.amount >= 0) acc.income += tx.amount;
    else acc.spend += Math.abs(tx.amount);
    return acc;
  }, { income: 0, spend: 0 });

  const categoryMap = new Map();
  transactions.forEach((tx) => {
    const key = tx.category || 'Other';
    const current = categoryMap.get(key) || { category: key, inflow: 0, outflow: 0 };
    if (tx.amount >= 0) current.inflow += tx.amount;
    else current.outflow += Math.abs(tx.amount);
    categoryMap.set(key, current);
  });

  const categories = Array.from(categoryMap.values())
    .sort((a, b) => (b.outflow || b.inflow) - (a.outflow || a.inflow));
  const totalOutflow = categories.reduce((sum, item) => sum + (item.outflow || 0), 0);
  const spendingCategories = categories
    .filter((item) => item.outflow || item.inflow)
    .map((item) => ({
      label: item.category,
      category: item.category,
      amount: item.outflow || item.inflow || 0,
      outflow: item.outflow || 0,
      inflow: item.inflow || 0,
      share: totalOutflow ? (item.outflow || 0) / totalOutflow : 0,
    }));

  const topCategories = categories
    .filter((item) => item.outflow)
    .slice(0, 5)
    .map((item) => ({
      category: item.category,
      outflow: item.outflow,
      inflow: item.inflow,
    }));

  const largestExpenses = transactions
    .filter((tx) => tx.amount < 0)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, 5)
    .map((tx) => ({
      description: tx.description,
      amount: Math.abs(tx.amount),
      category: tx.category,
      date: tx.date || null,
      accountName: tx.accountName || null,
    }));

  return {
    transactions,
    totals,
    accounts: Array.from(accounts.values()).map((acc) => ({
      ...acc,
      totals: {
        income: Math.round(acc.totals.income * 100) / 100,
        spend: Math.round(acc.totals.spend * 100) / 100,
      },
    })),
    spendingCategories,
    topCategories,
    largestExpenses,
    transferCount,
  };
}

function selectLatest(summaries) {
  return summaries
    .filter(Boolean)
    .sort((a, b) => {
      const aTime = a.sortKey ? new Date(a.sortKey).getTime() : 0;
      const bTime = b.sortKey ? new Date(b.sortKey).getTime() : 0;
      return bTime - aTime;
    })[0] || null;
}

function buildAggregatesFromVault(sources) {
  const result = {
    income: {},
    cashflow: {},
    savings: {},
    pension: {},
    tax: {},
  };

  const sourceList = Object.values(sources || {}).filter(Boolean);
  const payslipSummaries = [];
  const statementSummaries = [];
  const savingsSummaries = [];
  const pensionSummaries = [];
  const hmrcSummaries = [];

  sourceList.forEach((entry) => {
    const baseKey = entry?.baseKey || entry?.key;
    if (!baseKey) return;
    if (baseKey === 'payslip') {
      const summary = summarisePayslip(entry);
      if (summary) payslipSummaries.push(summary);
      return;
    }
    if (baseKey === 'current_account_statement') {
      const summary = summariseStatement(entry);
      if (summary) statementSummaries.push(summary);
      return;
    }
    if (baseKey === 'savings_account_statement' || baseKey === 'isa_statement') {
      const summary = summariseSavings(entry);
      if (summary) savingsSummaries.push(summary);
      return;
    }
    if (baseKey === 'pension_statement') {
      const summary = summarisePension(entry);
      if (summary) pensionSummaries.push(summary);
      return;
    }
    if (baseKey === 'hmrc_correspondence') {
      const summary = summariseHmrc(entry);
      if (summary) hmrcSummaries.push(summary);
    }
  });

  const latestPayslip = selectLatest(payslipSummaries);
  if (latestPayslip) {
    result.income = {
      ...latestPayslip.metrics,
      earnings: latestPayslip.earnings,
      deductions: latestPayslip.deductions,
      allowances: latestPayslip.allowances,
      periodLabel: latestPayslip.period.label,
      periodStart: latestPayslip.metrics.periodStart,
      periodEnd: latestPayslip.metrics.periodEnd,
    };
    if (latestPayslip.metrics.gross && latestPayslip.metrics.net && latestPayslip.metrics.gross !== 0) {
      result.income.takeHomePercent = latestPayslip.metrics.net / latestPayslip.metrics.gross;
    }
  }

  if (statementSummaries.length) {
    const statementCollections = summariseStatementCollections(statementSummaries);
    const totals = statementCollections.totals;
    const latestStatement = selectLatest(statementSummaries);
    const periodLabel = latestStatement?.period?.label || null;
    const periodStart = latestStatement?.period?.start || null;
    const periodEnd = latestStatement?.period?.end || null;
    const net = totals.income - totals.spend;
    result.cashflow = {
      hasData: true,
      income: Math.round(totals.income * 100) / 100,
      spend: Math.round(totals.spend * 100) / 100,
      net: Math.round(net * 100) / 100,
      topCategories: statementCollections.topCategories,
      largestExpenses: statementCollections.largestExpenses,
      accounts: statementCollections.accounts,
      transferCount: statementCollections.transferCount,
      spendingCanteorgies: statementCollections.spendingCategories,
      transactions: statementCollections.transactions,
      periodLabel,
      periodStart,
      periodEnd,
    };
  }

  if (savingsSummaries.length) {
    const latest = selectLatest(savingsSummaries);
    const balance = savingsSummaries.reduce((acc, entry) => acc + (entry.balance || 0), 0);
    result.savings = {
      balance: Math.round(balance * 100) / 100,
      interest: latest?.interest ?? null,
    };
  }

  if (pensionSummaries.length) {
    const latest = selectLatest(pensionSummaries);
    result.pension = {
      balance: latest?.balance ?? null,
      contributions: latest?.contributions ?? null,
    };
  }

  if (hmrcSummaries.length) {
    const latest = selectLatest(hmrcSummaries);
    result.tax = {
      taxDue: latest?.taxDue ?? null,
    };
  }

  return result;
}

function buildTimelineFromVault(sources) {
  const buckets = new Map();
  const sourceList = Object.values(sources || {}).filter(Boolean);

  const ensureBucket = (monthKey) => {
    if (!buckets.has(monthKey)) {
      const { label, start, end } = buildPeriodFromMonthKey(monthKey);
      buckets.set(monthKey, {
        period: {
          month: monthKey,
          label,
          start,
          end,
        },
        payslip: null,
        statements: {
          income: 0,
          spend: 0,
          net: 0,
          transactions: 0,
          spendingCanteorgies: [],
        },
        sources: { payslip: false, statements: false },
        statementPeriods: new Set(),
      });
    }
    return buckets.get(monthKey);
  };

  sourceList.forEach((entry) => {
    const baseKey = entry?.baseKey || entry?.key;
    if (!baseKey) return;
    if (baseKey === 'payslip') {
      const summary = summarisePayslip(entry);
      if (!summary || !summary.monthKey) return;
      const bucket = ensureBucket(summary.monthKey);
      bucket.sources.payslip = true;
      const metrics = summary.metrics;
      if (!bucket.payslip || (bucket.payslip.payDate || '').localeCompare(metrics.payDate || '') < 0) {
        bucket.payslip = {
          gross: metrics.gross ?? null,
          net: metrics.net ?? null,
          tax: metrics.tax ?? null,
          ni: metrics.ni ?? null,
          pension: metrics.pension ?? null,
          studentLoan: metrics.studentLoan ?? null,
          totalDeductions: metrics.totalDeductions ?? null,
          takeHomePercent: metrics.takeHomePercent ?? null,
          payFrequency: metrics.payFrequency || null,
          taxCode: metrics.taxCode || null,
          employerName: metrics.employerName || null,
          payDate: metrics.payDate || null,
          periodStart: metrics.periodStart || null,
          periodEnd: metrics.periodEnd || null,
        };
      }
      return;
    }
    if (baseKey === 'current_account_statement') {
      const summary = summariseStatement(entry);
      if (!summary || !summary.monthKey) return;
      const bucket = ensureBucket(summary.monthKey);
      bucket.sources.statements = true;
      summary.transactions.forEach((tx) => {
        if (tx.amount >= 0) bucket.statements.income += tx.amount;
        else bucket.statements.spend += Math.abs(tx.amount);
        bucket.statements.transactions += 1;
      });
      const categoryMap = new Map(
        bucket.statements.spendingCanteorgies.map((item) => [item.category, item])
      );
      summary.transactions.forEach((tx) => {
        const key = tx.category || 'Other';
        const record = categoryMap.get(key) || { label: key, category: key, amount: 0, outflow: 0, inflow: 0 };
        if (tx.amount >= 0) {
          record.inflow += tx.amount;
          record.amount += tx.amount;
        } else {
          const abs = Math.abs(tx.amount);
          record.outflow += abs;
          record.amount += abs;
        }
        categoryMap.set(key, record);
      });
      bucket.statements.spendingCanteorgies = Array.from(categoryMap.values());
      if (summary.period?.start || summary.period?.end) {
        bucket.statementPeriods.add(JSON.stringify({
          start: summary.period.start || null,
          end: summary.period.end || null,
          accountId: summary.account?.accountId || null,
        }));
      }
    }
  });

  const timeline = Array.from(buckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, bucket]) => {
      const income = Math.round(bucket.statements.income * 100) / 100;
      const spend = Math.round(bucket.statements.spend * 100) / 100;
      const totalOutflow = bucket.statements.spendingCanteorgies.reduce((acc, item) => acc + (item.outflow || item.amount || 0), 0);
      const spendingCanteorgies = bucket.statements.spendingCanteorgies.map((item) => ({
        label: item.label,
        category: item.category,
        amount: item.outflow || item.amount || 0,
        outflow: item.outflow || 0,
        inflow: item.inflow || 0,
        share: totalOutflow ? (item.outflow || item.amount || 0) / totalOutflow : 0,
      }));
      return {
        period: bucket.period,
        payslip: bucket.payslip,
        statements: {
          income,
          spend,
          net: Math.round((income - spend) * 100) / 100,
          transactions: bucket.statements.transactions,
          spendingCanteorgies,
        },
        sources: bucket.sources,
        statementPeriods: Array.from(bucket.statementPeriods),
      };
    });

  return timeline;
}

module.exports = {
  buildAggregatesFromVault,
  buildTimelineFromVault,
  __private__: {
    extractVaultData,
    summarisePayslip,
    summariseStatement,
  },
};

