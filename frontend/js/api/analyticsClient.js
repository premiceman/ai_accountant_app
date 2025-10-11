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

  async function fetchJson(path) {
    const res = await Auth.fetch(path, { cache: 'no-store' });
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
    return res.json();
  }

  function isoDate(value) {
    if (!value) return null;
    if (typeof value === 'string') return value.slice(0, 10);
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }

  function mapCategories(payload) {
    const categories = Array.isArray(payload?.categories) ? payload.categories : [];
    const totalMinor = categories.reduce((acc, item) => acc + Number(item?.outflowMinor || 0), 0);
    return categories.map((item) => {
      const amountMinor = Number(item?.outflowMinor || 0);
      const amount = minorToMajor(amountMinor);
      const share = totalMinor ? amountMinor / totalMinor : 0;
      return {
        label: item?.category || 'Category',
        category: item?.category || 'Category',
        amount,
        outflow: amount,
        inflow: minorToMajor(item?.inflowMinor || 0),
        share,
      };
    });
  }

  function mapLargestExpenses(payload) {
    const items = Array.isArray(payload?.items) ? payload.items : [];
    return items.map((item) => ({
      description: item?.description || 'Transaction',
      date: item?.date || null,
      amount: minorToMajor(item?.amountMinor || 0),
      category: item?.category || 'Other',
      accountId: item?.accountId || null,
    }));
  }

  function mapAccounts(payload) {
    const accounts = Array.isArray(payload?.accounts) ? payload.accounts : [];
    return accounts.map((account) => ({
      accountId: account?.accountId || null,
      accountName: account?.name || account?.accountId || 'Account',
      bankName: account?.bank || null,
      totals: {
        income: minorToMajor(account?.incomeMinor || 0),
        spend: minorToMajor(account?.spendMinor || 0),
      },
    }));
  }

  function applySummaryToMetrics(legacy, summary) {
    if (!legacy || !legacy.accounting) return;
    const totals = summary?.totals || {};
    const income = minorToMajor(totals.incomeMinor);
    const spend = minorToMajor(totals.spendMinor);
    const net = minorToMajor(totals.netMinor);
    const savings = income != null && spend != null ? income - spend : null;
    if (Array.isArray(legacy.accounting.metrics)) {
      legacy.accounting.metrics = legacy.accounting.metrics.map((metric) => {
        if (!metric || typeof metric !== 'object') return metric;
        if (metric.key === 'income' && income != null) {
          return { ...metric, value: income };
        }
        if (metric.key === 'spend' && spend != null) {
          return { ...metric, value: spend };
        }
        if (metric.key === 'savingsCapacity' && savings != null) {
          return { ...metric, value: savings };
        }
        return metric;
      });
    }
    if (legacy.accounting?.comparatives?.values) {
      legacy.accounting.comparatives.values = legacy.accounting.comparatives.values.map((item) => {
        if (!item || typeof item !== 'object') return item;
        if (item.key === 'income' && income != null) return { ...item, current: income };
        if (item.key === 'spend' && spend != null) return { ...item, current: spend };
        if (item.key === 'savingsCapacity' && savings != null) return { ...item, current: savings };
        if (item.key === 'net' && net != null) return { ...item, current: net };
        return item;
      });
    }
  }

  function applyHighlights(legacy, summaryPayload, categoriesPayload, largestPayload, accountsPayload) {
    if (!legacy.accounting) return;
    const statementHighlights = legacy.accounting.statementHighlights || {};
    const categories = mapCategories(categoriesPayload);
    const largest = mapLargestExpenses(largestPayload);
    const accounts = mapAccounts(accountsPayload);
    const totals = summaryPayload?.totals || {};
    statementHighlights.totalIncome = minorToMajor(totals.incomeMinor || 0);
    statementHighlights.totalSpend = minorToMajor(totals.spendMinor || 0);
    statementHighlights.topCategories = categories.slice(0, 5).map((item) => ({
      category: item.category,
      outflow: item.amount,
      inflow: item.inflow,
    }));
    statementHighlights.largestExpenses = largest;
    statementHighlights.accounts = accounts;
    statementHighlights.spendingCanteorgies = categories;
    legacy.accounting.statementHighlights = statementHighlights;
    legacy.accounting.spendByCategory = categories;
    legacy.accounting.spendingCanteorgies = categories;
    legacy.accounting.largestExpenses = largest;
  }

  async function loadDashboard(params = {}) {
    const search = new URLSearchParams();
    if (params.preset) search.set('preset', params.preset);
    if (params.t) search.set('t', params.t);
    const legacyRes = await Auth.fetch(`/api/analytics/dashboard?${search.toString()}`, { cache: 'no-store' });
    if (!legacyRes.ok) {
      const text = await legacyRes.text();
      const error = new Error(text || `Analytics ${legacyRes.status}`);
      error.status = legacyRes.status;
      error.reason = text || legacyRes.statusText;
      throw error;
    }
    const legacy = await legacyRes.json();
    const flags = await fetchFlags();
    if (!flags.ENABLE_FRONTEND_ANALYTICS_V1) {
      return legacy;
    }

    const range = legacy?.range || {};
    const start = isoDate(range.start);
    const end = isoDate(range.end);
    if (!start || !end) {
      return legacy;
    }
    const granularity = params.granularity || 'month';
    const summaryPromise = fetchJson(`/api/analytics/v1/summary?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&granularity=${encodeURIComponent(granularity)}&homeCurrency=GBP`);
    const categoriesPromise = fetchJson(`/api/analytics/v1/categories?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
    const largestPromise = fetchJson(`/api/analytics/v1/largest-expenses?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&limit=10`);
    const accountsPromise = fetchJson(`/api/analytics/v1/accounts?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
    const timeseriesPromise = fetchJson(`/api/analytics/v1/timeseries?metric=net&granularity=${encodeURIComponent(granularity)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);

    const [summary, categories, largest, accounts, timeseries] = await Promise.all([
      summaryPromise,
      categoriesPromise,
      largestPromise,
      accountsPromise,
      timeseriesPromise,
    ]);

    applySummaryToMetrics(legacy, summary);
    applyHighlights(legacy, summary, categories, largest, accounts);

    if (legacy.accounting) {
      legacy.accounting.timeseriesV1 = timeseries || null;
    }

    if (typeof legacy.hasData !== 'boolean') {
      legacy.hasData = Boolean(summary?.totals?.incomeMinor || summary?.totals?.spendMinor);
    }

    return legacy;
  }

  window.AnalyticsClient = {
    loadDashboard,
    getFlags: fetchFlags,
    minorToMajor,
  };
})();
