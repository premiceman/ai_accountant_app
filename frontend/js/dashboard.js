// frontend/js/dashboard.js
(function () {
  init().catch((error) => {
    console.error('Dashboard failed to initialise', error);
    softError('Unable to load dashboard right now. Please refresh.');
  });

  async function init() {
    const { me } = await Auth.requireAuth();
    Auth.setBannerTitle('Intelligence Dashboard');
    const insights = await loadInsights();
    renderDashboard(insights, me);
  }

  async function loadInsights() {
    try {
      const response = await Auth.fetch('/api/user/me', { cache: 'no-store' });
      if (!response.ok) {
        const text = await safeRead(response);
        throw new Error(text || `Request failed (${response.status})`);
      }
      const payload = await response.json();
      return payload?.documentInsights || {};
    } catch (error) {
      console.error('Failed to load document insights', error);
      throw error;
    }
  }

  async function safeRead(response) {
    try {
      const type = response.headers.get('content-type') || '';
      if (type.includes('application/json')) {
        const data = await response.json();
        if (data && typeof data === 'object') {
          return data.error || data.message || JSON.stringify(data);
        }
        return JSON.stringify(data);
      }
      return await response.text();
    } catch (error) {
      console.warn('Failed to parse error response', error);
      return '';
    }
  }

  function renderDashboard(insights = {}, me = null) {
    if (me?.firstName) {
      const greeting = byId('greeting-name');
      if (greeting) greeting.textContent = me.firstName;
    }

    const sources = normaliseSources(insights?.sources);
    const latestPayslip = selectLatestSource(sources, 'payslip');
    const latestStatement = selectLatestSource(sources, 'current_account_statement');

    toggleDashboardEmpty(!latestPayslip && !latestStatement);
    renderPayslip(latestPayslip);
    renderBankStatement(latestStatement);
  }

  function normaliseSources(sources) {
    if (!sources || typeof sources !== 'object') return [];
    return Object.values(sources).filter(Boolean);
  }

  function selectLatestSource(sourceList, baseKey) {
    if (!Array.isArray(sourceList) || !sourceList.length) return null;
    const matching = sourceList.filter((entry) => {
      const key = entry?.baseKey || entry?.key || '';
      return key === baseKey || key.startsWith(`${baseKey}:`);
    });
    if (!matching.length) return null;
    matching.sort((a, b) => getEntryTimestamp(b) - getEntryTimestamp(a));
    return matching[0] || null;
  }

  function getEntryTimestamp(entry) {
    const metrics = entry?.metrics || {};
    const metadata = entry?.metadata || {};
    const period = metadata?.period || entry?.period || {};
    const files = Array.isArray(entry?.files) ? entry.files : [];
    const candidates = [
      metrics.payDate,
      metadata.payDate,
      metrics.periodEnd,
      metrics.periodStart,
      period.end,
      period.start,
      metadata.documentDate,
      entry?.documentDate,
      ...(files.map((file) => file?.uploadedAt)),
    ];
    const timestamps = candidates
      .map(parseDate)
      .filter(Boolean)
      .map((date) => date.getTime());
    if (!timestamps.length) return 0;
    return Math.max(...timestamps);
  }

  function renderPayslip(entry) {
    const empty = byId('payslip-empty');
    const content = byId('payslip-content');

    if (!entry) {
      if (content) content.classList.add('d-none');
      if (empty) {
        empty.textContent = 'Upload a current payslip to unlock granular analytics.';
        empty.classList.remove('d-none');
      }
      setText('payslip-gross', '£—');
      setText('payslip-net', '£—');
      setText('payslip-deductions', '£—');
      setText('payslip-period', '—');
      setText('payslip-frequency', '—');
      clearTable(byId('payslip-earnings-body'));
      clearTable(byId('payslip-deductions-body'));
      return;
    }

    empty?.classList.add('d-none');
    content?.classList.remove('d-none');

    const metrics = entry.metrics || {};
    const metadata = entry.metadata || {};

    setText('payslip-period', buildPayslipPeriodLabel(metrics, metadata));
    setText('payslip-frequency', metrics.payFrequency || '—');
    setText('payslip-gross', formatMoney(pickNumber(metrics, ['gross', 'grossAmount'])));
    setText('payslip-net', formatMoney(pickNumber(metrics, ['net', 'netPay'])));
    setText('payslip-deductions', formatMoney(pickNumber(metrics, ['totalDeductions', 'deductionsTotal', 'tax'])));

    renderLineItems(byId('payslip-earnings-body'), normaliseLineItems(metrics.earnings));
    renderLineItems(byId('payslip-deductions-body'), normaliseLineItems(metrics.deductions));
  }

  function buildPayslipPeriodLabel(metrics = {}, metadata = {}) {
    const start = metrics.periodStart || metadata.period?.start || null;
    const end = metrics.periodEnd || metadata.period?.end || null;
    if (start && end) return formatRange(start, end);
    const payDate = metrics.payDate || metadata.payDate || metadata.documentDate;
    if (payDate) return formatDateLabel(payDate);
    const month = metadata.period?.month || metadata.documentMonth;
    if (month) return formatMonth(month);
    return '—';
  }

  function renderLineItems(tbody, rows) {
    if (!tbody) return;
    clearTable(tbody);
    if (!rows.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="2" class="text-muted small">No data available</td>';
      tbody.appendChild(tr);
      return;
    }
    rows.forEach((row) => {
      const tr = document.createElement('tr');
      const label = escapeHtml(row.label || 'Item');
      tr.innerHTML = `
        <td>${label}</td>
        <td class="text-end">${formatMoney(row.amount)}</td>`;
      tbody.appendChild(tr);
    });
  }

  function normaliseLineItems(list) {
    if (!Array.isArray(list)) return [];
    return list
      .map((item) => ({
        label: item?.label || item?.name || item?.category || 'Item',
        amount: pickNumber(item, ['amount', 'value', 'total', 'gross', 'net'])
      }))
      .filter((item) => item.label);
  }

  function renderBankStatement(entry) {
    const empty = byId('bank-empty');
    const content = byId('bank-content');

    if (!entry) {
      if (content) content.classList.add('d-none');
      if (empty) {
        empty.textContent = 'Upload a current account statement to populate this summary.';
        empty.classList.remove('d-none');
      }
      setText('bank-period', '—');
      setText('bank-opening', '£—');
      setText('bank-closing', '£—');
      setText('bank-in', '£—');
      setText('bank-out', '£—');
      clearTable(byId('bank-transactions-body'));
      return;
    }

    empty?.classList.add('d-none');
    content?.classList.remove('d-none');

    const metrics = entry.metrics || {};
    const metadata = entry.metadata || {};
    const period = metadata.period || entry.period || {};

    const start = period.start || metrics.periodStart || null;
    const end = period.end || metrics.periodEnd || null;
    const month = period.month || metadata.documentMonth || null;

    setText('bank-period', formatPeriodLabel({ start, end, month }));
    setText('bank-opening', formatMoney(pickNumber(metrics, ['openingBalance', 'opening'])));
    setText('bank-closing', formatMoney(pickNumber(metrics, ['closingBalance', 'closing'])));
    setText('bank-in', formatMoney(pickNumber(metrics, ['inflows', 'totalMoneyIn', 'moneyIn'])));
    setText('bank-out', formatMoney(pickNumber(metrics, ['outflows', 'totalMoneyOut', 'moneyOut'])));

    renderTransactions(byId('bank-transactions-body'), entry.transactions || []);
  }

  function renderTransactions(tbody, transactions) {
    if (!tbody) return;
    clearTable(tbody);
    const rows = Array.isArray(transactions) ? transactions.slice() : [];
    rows.sort((a, b) => (parseDate(b?.date)?.getTime() || 0) - (parseDate(a?.date)?.getTime() || 0));
    const top = rows.slice(0, 5);
    if (!top.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="3" class="text-muted small">No transactions captured.</td>';
      tbody.appendChild(tr);
      return;
    }
    top.forEach((tx) => {
      const tr = document.createElement('tr');
      const amount = Number(tx?.amount);
      const amountLabel = Number.isFinite(amount) ? formatMoney(amount, { sign: true }) : '£—';
      const amountClass = Number.isFinite(amount)
        ? amount >= 0
          ? 'text-success'
          : 'text-danger'
        : 'text-muted';
      tr.innerHTML = `
        <td>${escapeHtml(formatDateLabel(tx?.date) || '—')}</td>
        <td>${escapeHtml(tx?.description || 'Transaction')}</td>
        <td class="text-end ${amountClass}">${amountLabel}</td>`;
      tbody.appendChild(tr);
    });
  }

  function toggleDashboardEmpty(show) {
    const el = byId('dashboard-empty-state');
    if (!el) return;
    el.classList.toggle('d-none', !show);
    if (!show) {
      el.classList.remove('alert-danger');
      if (!el.classList.contains('alert-warning')) {
        el.classList.add('alert-warning');
      }
      const msg = el.querySelector('[data-error-message]');
      if (msg) {
        msg.textContent = 'Add payslips, bank and savings statements, ISA summaries and more from the document vault.';
      }
    }
  }

  function setText(id, value) {
    const el = typeof id === 'string' ? byId(id) : id;
    if (!el) return;
    el.textContent = value == null ? '' : String(value);
  }

  function clearTable(tbody) {
    if (!tbody) return;
    while (tbody.firstChild) {
      tbody.removeChild(tbody.firstChild);
    }
  }

  function formatMoney(value, { sign = false } = {}) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '£—';
    const abs = Math.abs(num);
    const formatted = abs.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (!sign) {
      return `£${formatted}`;
    }
    if (num > 0) return `+£${formatted}`;
    if (num < 0) return `−£${formatted}`;
    return `£${formatted}`;
  }

  function pickNumber(obj, keys) {
    if (!obj) return null;
    for (const key of keys) {
      if (obj[key] == null) continue;
      const num = Number(obj[key]);
      if (Number.isFinite(num)) return num;
    }
    return null;
  }

  function parseDate(value) {
    if (!value) return null;
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }
    const str = String(value);
    if (/^\d{4}-\d{2}$/.test(str)) {
      const d = new Date(`${str}-01T00:00:00Z`);
      if (!Number.isNaN(d.getTime())) return d;
    }
    const date = new Date(str);
    if (Number.isNaN(date.getTime())) return null;
    return date;
  }

  function formatRange(start, end) {
    const startDate = parseDate(start);
    const endDate = parseDate(end);
    if (!startDate && !endDate) return '—';
    if (startDate && endDate) {
      const sameMonth = startDate.getMonth() === endDate.getMonth() && startDate.getFullYear() === endDate.getFullYear();
      const optionsStart = sameMonth
        ? { day: 'numeric' }
        : { day: 'numeric', month: 'short' };
      const startLabel = startDate.toLocaleDateString('en-GB', optionsStart);
      const endLabel = endDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      return `${startLabel} – ${endLabel}`;
    }
    const single = endDate || startDate;
    return single ? single.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  }

  function formatMonth(month) {
    if (!month) return '—';
    const [year, monthStr] = String(month).split('-');
    if (!year || !monthStr) return '—';
    const index = Number(monthStr) - 1;
    if (!Number.isInteger(index)) return '—';
    const date = new Date(Date.UTC(Number(year), index, 1));
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  }

  function formatDateLabel(value) {
    const date = parseDate(value);
    if (!date) return '';
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function formatPeriodLabel({ start = null, end = null, month = null } = {}) {
    if (start && end) return formatRange(start, end);
    if (month) return formatMonth(month);
    if (end) return formatDateLabel(end);
    if (start) return formatDateLabel(start);
    return '—';
  }

  function softError(message) {
    const el = byId('dashboard-empty-state');
    if (!el) return;
    el.classList.remove('d-none');
    el.classList.remove('alert-warning');
    el.classList.add('alert-danger');
    const text = el.querySelector('[data-error-message]');
    if (text) {
      text.textContent = message;
    } else {
      el.textContent = message;
    }
  }

  function escapeHtml(value) {
    if (value == null) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function byId(id) {
    return document.getElementById(id);
  }
})();
