// NOTE: Hotfix — TS types for shared flags + FE v1 flip + staged loader + prefer-v1 legacy; aligns with Phase-1/2/3 specs. Additive, non-breaking.
(function () {
  const DEFAULT_FLAGS = {
    ENABLE_FRONTEND_ANALYTICS_V1: true,
    ENABLE_STAGED_LOADER_ANALYTICS: true,
  };

  let flagsCache = null;
  let flagsPromise = null;

  function minorToMajor(value) {
    const num = Number(value || 0);
    if (!Number.isFinite(num)) return 0;
    return Math.round(num) / 100;
  }

  function toNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function valueFromMinorOrMajor(source = {}, minorKey, majorKey) {
    if (source && minorKey && source[minorKey] != null) {
      const minor = toNumber(source[minorKey]);
      if (minor != null) return minorToMajor(minor);
    }
    if (source && majorKey && source[majorKey] != null) {
      const major = toNumber(source[majorKey]);
      if (major != null) return major;
    }
    return null;
  }

  function rateFromValue(source = {}, rateKey, bpsKey) {
    if (source && rateKey && source[rateKey] != null) {
      const rate = toNumber(source[rateKey]);
      if (rate != null) return rate;
    }
    if (source && bpsKey && source[bpsKey] != null) {
      const basisPoints = toNumber(source[bpsKey]);
      if (basisPoints != null) return basisPoints / 10000;
    }
    return null;
  }

  function mapMoneyRows(list, { labelKey = 'label' } = {}) {
    if (!Array.isArray(list)) return [];
    return list
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const amount = valueFromMinorOrMajor(item, 'amountMinor', 'amount');
        const label = item[labelKey] || item.label || item.category || null;
        const category = item.category || null;
        if (amount == null && label == null) return null;
        return {
          label: label || (category || 'Item'),
          category,
          amount: amount != null ? amount : 0,
        };
      })
      .filter(Boolean);
  }

  function mapPayslipInsights(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const metrics = payload.metrics && typeof payload.metrics === 'object' ? payload.metrics : payload;
    const earnings = mapMoneyRows(metrics.earnings);
    const deductions = mapMoneyRows(metrics.deductions);
    const allowances = mapMoneyRows(metrics.allowances);

    const gross = valueFromMinorOrMajor(metrics, 'grossMinor', 'gross');
    const net = valueFromMinorOrMajor(metrics, 'netMinor', 'net');
    const grossYtd = valueFromMinorOrMajor(metrics, 'grossYtdMinor', 'grossYtd');
    const netYtd = valueFromMinorOrMajor(metrics, 'netYtdMinor', 'netYtd');
    const totalDeductions = valueFromMinorOrMajor(metrics, 'totalDeductionsMinor', 'totalDeductions');
    const tax = valueFromMinorOrMajor(metrics, 'taxMinor', 'tax');
    const ni = valueFromMinorOrMajor(metrics, 'nationalInsuranceMinor', 'ni');
    const pension = valueFromMinorOrMajor(metrics, 'pensionMinor', 'pension');
    const studentLoan = valueFromMinorOrMajor(metrics, 'studentLoanMinor', 'studentLoan');
    const annualisedGross = valueFromMinorOrMajor(metrics, 'annualisedGrossMinor', 'annualisedGross');

    const effectiveMarginalRate = rateFromValue(metrics, 'effectiveMarginalRate', 'effectiveMarginalRateBasisPoints');
    const expectedMarginalRate = rateFromValue(metrics, 'expectedMarginalRate', 'expectedMarginalRateBasisPoints');
    const marginalRateDelta = rateFromValue(metrics, 'marginalRateDelta', 'marginalRateDeltaBasisPoints');

    const takeHomePercent = metrics.takeHomePercent != null
      ? toNumber(metrics.takeHomePercent)
      : metrics.takeHomeRate != null
        ? toNumber(metrics.takeHomeRate)
        : (gross != null && gross !== 0 && net != null)
          ? net / gross
          : null;

    const notes = Array.isArray(metrics.notes)
      ? metrics.notes.filter((note) => typeof note === 'string' && note.trim().length)
      : [];

    const hasMetricValue = [gross, net, tax, ni, pension, studentLoan, totalDeductions, annualisedGross]
      .some((value) => value != null);
    const hasBreakdown = earnings.length > 0 || deductions.length > 0 || allowances.length > 0;

    const hasValues = hasMetricValue || hasBreakdown;

    if (!hasValues) return null;

    return {
      gross,
      grossYtd,
      net,
      netYtd,
      tax,
      ni,
      pension,
      studentLoan,
      totalDeductions,
      annualisedGross,
      effectiveMarginalRate,
      expectedMarginalRate,
      marginalRateDelta,
      takeHomePercent,
      payFrequency: metrics.payFrequency || metrics.frequency || null,
      taxCode: metrics.taxCode || metrics.taxCodeCurrent || null,
      payDate: metrics.payDate || metrics.period?.end || payload.payDate || null,
      periodStart: metrics.periodStart || metrics.period?.start || payload.period?.start || null,
      periodEnd: metrics.periodEnd || metrics.period?.end || payload.period?.end || null,
      extractionSource: metrics.extractionSource || null,
      earnings,
      deductions,
      allowances,
      notes,
    };
  }

  function mapStatementInsights(payload) {
    if (!payload || typeof payload !== 'object') {
      return { highlights: null, categories: [], largestExpenses: [] };
    }

    const totals = payload.totals && typeof payload.totals === 'object' ? payload.totals : payload.summary || {};
    const totalIncome = valueFromMinorOrMajor(totals, 'incomeMinor', 'income');
    const totalSpend = valueFromMinorOrMajor(totals, 'spendMinor', 'spend');

    const categoriesSource = Array.isArray(payload.categories)
      ? payload.categories
      : Array.isArray(payload.spendingCanteorgies)
        ? payload.spendingCanteorgies
        : [];

    const categories = categoriesSource.map((category) => {
      if (!category || typeof category !== 'object') return null;
      const outflow = valueFromMinorOrMajor(category, 'outflowMinor', 'outflow');
      const inflow = valueFromMinorOrMajor(category, 'inflowMinor', 'inflow');
      const amount = valueFromMinorOrMajor(category, 'amountMinor', 'amount');
      const label = category.label || category.category || 'Category';
      const share = category.share != null ? toNumber(category.share) : null;
      return {
        label,
        category: category.category || label,
        amount: amount != null ? amount : outflow != null ? outflow : inflow != null ? inflow : 0,
        outflow: outflow != null ? outflow : null,
        inflow: inflow != null ? inflow : null,
        share,
      };
    }).filter(Boolean);

    const totalForShare = categories.reduce((acc, item) => acc + (item.outflow != null ? item.outflow : item.amount || 0), 0);
    const categoriesWithShare = categories.map((item) => ({
      ...item,
      share: item.share != null ? item.share : totalForShare ? (item.outflow != null ? item.outflow : item.amount || 0) / totalForShare : 0,
    }));

    const topCategories = (Array.isArray(payload.topCategories) ? payload.topCategories : categoriesWithShare.slice(0, 5))
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const outflow = valueFromMinorOrMajor(item, 'outflowMinor', 'outflow');
        const inflow = valueFromMinorOrMajor(item, 'inflowMinor', 'inflow');
        const category = item.category || item.label || 'Category';
        return {
          category,
          outflow: outflow != null ? outflow : valueFromMinorOrMajor(item, 'amountMinor', 'amount'),
          inflow,
        };
      })
      .filter(Boolean);

    const largestExpensesSource = Array.isArray(payload.largestExpenses) ? payload.largestExpenses : [];
    const largestExpenses = largestExpensesSource
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const amount = valueFromMinorOrMajor(item, 'amountMinor', 'amount');
        const description = item.description || item.label || 'Transaction';
        return {
          description,
          amount: amount != null ? amount : 0,
          category: item.category || null,
          date: item.date || item.ts || null,
          accountId: item.accountId || null,
        };
      })
      .filter(Boolean);

    const accountsSource = Array.isArray(payload.accounts) ? payload.accounts : [];
    const accounts = accountsSource.map((account) => {
      if (!account || typeof account !== 'object') return null;
      const totals = account.totals && typeof account.totals === 'object' ? account.totals : account;
      return {
        accountId: account.accountId || account.id || null,
        accountName: account.accountName || account.name || account.accountId || 'Account',
        bankName: account.bankName || account.institutionName || null,
        accountNumberMasked: account.accountNumberMasked || account.masked || null,
        totals: {
          income: valueFromMinorOrMajor(totals, 'incomeMinor', 'income') || 0,
          spend: valueFromMinorOrMajor(totals, 'spendMinor', 'spend') || 0,
        },
      };
    }).filter(Boolean);

    const transferCount = toNumber(payload.transferCount ?? payload.transfers?.count) || 0;

    const highlightsAvailable = (
      totalIncome != null
      || totalSpend != null
      || topCategories.length > 0
      || largestExpenses.length > 0
      || accounts.length > 0
    );

    const highlights = highlightsAvailable
      ? {
          totalIncome,
          totalSpend,
          topCategories,
          largestExpenses,
          accounts,
          transferCount,
          spendingCanteorgies: categoriesWithShare,
        }
      : null;

    const rangeStatus = payload.rangeStatus
      || payload.status
      || (typeof payload.message === 'string' ? payload.message : null);

    return {
      highlights,
      categories: categoriesWithShare,
      largestExpenses,
      transferCount,
      rangeStatus,
    };
  }

  async function fetchFlags() {
    if (flagsCache) return flagsCache;
    if (flagsPromise) return flagsPromise;
    flagsPromise = (async () => {
      try {
        const res = await Auth.fetch('/api/flags', { cache: 'no-store' });
        if (!res.ok) throw new Error(`flags ${res.status}`);
        const data = await res.json();
        flagsCache = { ...DEFAULT_FLAGS, ...data };
      } catch (error) {
        console.warn('Failed to load flags, using defaults', error);
        flagsCache = { ...DEFAULT_FLAGS };
      } finally {
        flagsPromise = null;
      }
      return flagsCache;
    })();
    return flagsPromise;
  }

  function normaliseReason(raw) {
    if (!raw) return '';
    if (typeof raw === 'string') return raw;
    if (raw.error) return String(raw.error);
    if (raw.message) return String(raw.message);
    try {
      return JSON.stringify(raw);
    } catch (error) {
      return String(raw);
    }
  }

  async function loadDashboard(params = {}) {
    const search = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value == null || value === '') return;
      search.set(key, value);
    });
    const query = search.toString();
    const res = await Auth.fetch(`/api/analytics/doc-insights${query ? `?${query}` : ''}`, { cache: 'no-store' });
    if (!res.ok) {
      let reason = '';
      try {
        const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : await res.text();
        reason = normaliseReason(data);
      } catch (error) {
        reason = res.statusText || 'Request failed';
      }
      const err = new Error(reason || `Request failed with status ${res.status}`);
      err.status = res.status;
      err.reason = reason || res.statusText || 'Request failed';
      throw err;
    }
    if (res.status === 204) return null;
    const data = await res.json();

    const accounting = data && typeof data === 'object' && data.accounting && typeof data.accounting === 'object'
      ? data.accounting
      : {};

    const payslipSource = data?.payslipInsights
      ?? accounting.payslipInsights
      ?? data?.docInsights?.payslip
      ?? accounting.payslip
      ?? null;
    const statementSource = data?.statementInsights
      ?? accounting.statementInsights
      ?? data?.docInsights?.statements
      ?? accounting.statements
      ?? null;

    const payslipAnalytics = mapPayslipInsights(payslipSource);
    const statement = mapStatementInsights(statementSource);

    const categoriesForSpend = (statement.categories && statement.categories.length)
      ? statement.categories
      : accounting.spendByCategory || accounting.spendingCanteorgies || [];
    const largestExpenses = (statement.largestExpenses && statement.largestExpenses.length)
      ? statement.largestExpenses
      : accounting.largestExpenses || [];
    const statementHighlights = statement.highlights || accounting.statementHighlights || null;

    const nextAccounting = {
      ...accounting,
      payslipAnalytics: payslipAnalytics || accounting.payslipAnalytics || null,
      statementHighlights,
      largestExpenses,
      spendByCategory: categoriesForSpend,
      spendingCanteorgies: categoriesForSpend,
    };

    if (nextAccounting.statementHighlights && !nextAccounting.statementHighlights.spendingCanteorgies) {
      nextAccounting.statementHighlights.spendingCanteorgies = categoriesForSpend;
    }

    const mergedRangeStatus = {
      ...(data?.rangeStatus && typeof data.rangeStatus === 'object' ? data.rangeStatus : {}),
      ...(accounting.rangeStatus && typeof accounting.rangeStatus === 'object' ? accounting.rangeStatus : {}),
    };

    const statementStatus = statement.rangeStatus;
    if (statementStatus) {
      if (typeof statementStatus === 'string') mergedRangeStatus.statements = statementStatus;
      else if (typeof statementStatus === 'object') Object.assign(mergedRangeStatus, statementStatus);
    }

    if (!payslipAnalytics && payslipSource && typeof payslipSource === 'object') {
      const payslipStatus = payslipSource.rangeStatus || payslipSource.status || payslipSource.message;
      if (payslipStatus) mergedRangeStatus.payslip = payslipStatus;
    }

    if (Object.keys(mergedRangeStatus).length) {
      nextAccounting.rangeStatus = mergedRangeStatus;
    }

    return {
      ...data,
      accounting: nextAccounting,
    };
  }

  window.AnalyticsClient = {
    loadDashboard,
    getFlags: fetchFlags,
    minorToMajor,
    mapPayslipInsights,
    mapStatementInsights,
  };
})();
