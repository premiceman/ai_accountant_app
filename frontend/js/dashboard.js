// frontend/js/dashboard.js
(function () {
  const state = {
    payslips: [],
    selectedId: null,
    chart: null,
  };

  init().catch((error) => {
    console.error('Dashboard failed to initialise', error);
    softError('Unable to load dashboard right now. Please refresh.');
  });

  async function init() {
    const { me } = await Auth.requireAuth();
    Auth.setBannerTitle('Intelligence Dashboard');

    const [insights, payslipDataset] = await Promise.all([
      loadInsights().catch((error) => {
        console.warn('Proceeding without document insights', error);
        return {};
      }),
      loadPayslipDataset(),
    ]);

    renderDashboard({ me, insights, payslipDataset });
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

  async function loadPayslipDataset() {
    try {
      const response = await Auth.fetch('/api/analytics/payslips', { cache: 'no-store' });
      if (!response.ok) {
        const text = await safeRead(response);
        throw new Error(text || `Request failed (${response.status})`);
      }
      const payload = await response.json();
      const list = Array.isArray(payload?.payslips)
        ? payload.payslips
        : Array.isArray(payload)
          ? payload
          : [];
      return { list, error: null };
    } catch (error) {
      console.error('Failed to load payslip dataset', error);
      return { list: [], error };
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

  function renderDashboard({ insights = {}, payslipDataset = { list: [] }, me = null } = {}) {
    if (me?.firstName) {
      const greeting = byId('greeting-name');
      if (greeting) greeting.textContent = me.firstName;
    }

    const { list: rawPayslips = [], error: datasetError = null } = payslipDataset || {};
    const normalised = normalisePayslipList(rawPayslips);

    if (!normalised.length && datasetError) {
      softError('Unable to load payslip data right now. Please refresh.');
    }

    toggleDashboardEmpty(!normalised.length);

    state.payslips = normalised;
    state.selectedId = pickDefaultSelection(normalised, state.selectedId);

    renderPayslipSelector(normalised, state.selectedId);
    const selected = getSelectedPayslip();
    renderPayslipSummary(selected);
    renderHistogram(selected);
    renderPayslipJson(selected);
  }

  function renderPayslipSelector(payslips, selectedId) {
    const select = byId('payslip-selector');
    if (!select) return;

    select.innerHTML = '';

    if (!Array.isArray(payslips) || payslips.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No payslips available';
      select.appendChild(option);
      select.disabled = true;
      return;
    }

    payslips.forEach((payslip) => {
      const option = document.createElement('option');
      option.value = payslip.id;
      option.textContent = payslip.optionLabel;
      select.appendChild(option);
    });

    select.disabled = false;
    select.value = selectedId || payslips[0]?.id || '';

    if (!select.dataset.bound) {
      select.addEventListener('change', (event) => {
        const id = event.target.value || null;
        state.selectedId = id;
        const selected = getSelectedPayslip();
        renderPayslipSummary(selected);
        renderHistogram(selected);
        renderPayslipJson(selected);
      });
      select.dataset.bound = 'true';
    }
  }

  function getSelectedPayslip() {
    if (!state.selectedId) return null;
    return state.payslips.find((item) => item.id === state.selectedId) || null;
  }

  function renderPayslipSummary(payslip) {
    const empty = byId('payslip-empty');
    const content = byId('payslip-content');

    if (!payslip) {
      if (content) content.classList.add('d-none');
      if (empty) {
        empty.textContent = 'Upload a payslip or choose one from the selector to explore your earnings and deductions.';
        empty.classList.remove('d-none');
      }
      setText('payslip-gross', '£—');
      setText('payslip-net', '£—');
      setText('payslip-deductions', '£—');
      setText('payslip-period', '—');
      setText('payslip-frequency', '—');
      setText('payslip-paydate', '—');
      setText('payslip-uploaded', '—');
      setText('payslip-employer', '—');
      clearTable(byId('payslip-earnings-body'));
      clearTable(byId('payslip-deductions-body'));
      return;
    }

    empty?.classList.add('d-none');
    content?.classList.remove('d-none');

    setText('payslip-period', payslip.periodLabel || '—');
    setText('payslip-frequency', payslip.payFrequency || '—');
    setText('payslip-gross', formatMoney(Number.isFinite(payslip.gross) ? payslip.gross : undefined));
    setText('payslip-net', formatMoney(Number.isFinite(payslip.net) ? payslip.net : undefined));
    setText('payslip-deductions', formatMoney(Number.isFinite(payslip.deductionsTotal) ? payslip.deductionsTotal : undefined));
    setText('payslip-paydate', payslip.payDateLabel || '—');
    setText('payslip-uploaded', payslip.uploadedLabel || '—');
    setText('payslip-employer', payslip.employer || '—');

    renderLineItems(byId('payslip-earnings-body'), payslip.earnings);
    renderLineItems(byId('payslip-deductions-body'), payslip.deductions);
  }

  function renderHistogram(payslip) {
    const empty = byId('payslip-chart-empty');
    const wrapper = byId('payslip-chart-wrapper');
    const canvas = byId('payslip-chart');
    if (!empty || !wrapper || !canvas) return;

    const defaultMessage = 'Select a payslip to generate the earnings vs deductions histogram.';
    if (empty.textContent !== defaultMessage) {
      empty.textContent = defaultMessage;
    }

    if (!payslip || (!payslip.earnings.length && !payslip.deductions.length)) {
      destroyChart();
      wrapper.classList.add('d-none');
      empty.classList.remove('d-none');
      return;
    }

    if (typeof window.Chart === 'undefined') {
      console.warn('Chart.js is not available.');
      destroyChart();
      wrapper.classList.add('d-none');
      empty.classList.remove('d-none');
      empty.textContent = 'Chart library unavailable. Install Chart.js to view the histogram.';
      return;
    }

    const labels = [...new Set([
      ...payslip.earnings.map((item) => item.label),
      ...payslip.deductions.map((item) => item.label),
    ])];
    const earningsMap = new Map(payslip.earnings.map((item) => [item.label, Number(item.amount || 0)]));
    const deductionsMap = new Map(payslip.deductions.map((item) => [item.label, Number(item.amount || 0)]));
    const earningsData = labels.map((label) => earningsMap.get(label) || 0);
    const deductionsData = labels.map((label) => -(deductionsMap.get(label) || 0));

    destroyChart();

    const ctx = canvas.getContext('2d');
    const computedStyle = getComputedStyle(document.documentElement);
    const success = computedStyle.getPropertyValue('--bs-success-rgb') || '25,135,84';
    const danger = computedStyle.getPropertyValue('--bs-danger-rgb') || '220,53,69';
    const textMuted = computedStyle.getPropertyValue('--bs-secondary-color') || '#6c757d';

    state.chart = new window.Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Earnings',
            data: earningsData,
            backgroundColor: `rgba(${success.trim()},0.85)`,
            borderRadius: 6,
            maxBarThickness: 36,
          },
          {
            label: 'Deductions',
            data: deductionsData,
            backgroundColor: `rgba(${danger.trim()},0.85)`,
            borderRadius: 6,
            maxBarThickness: 36,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: {
            labels: {
              color: textMuted || '#6c757d',
            },
          },
          tooltip: {
            callbacks: {
              label(context) {
                const label = context.dataset?.label || '';
                const value = Math.abs(Number(context.parsed?.y ?? 0));
                return `${label}: ${formatMoney(value)}`;
              },
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: textMuted || '#6c757d',
              callback(value, idx) {
                const label = labels[idx];
                return typeof label === 'string' ? label : value;
              },
            },
            grid: {
              display: false,
            },
          },
          y: {
            beginAtZero: true,
            ticks: {
              color: textMuted || '#6c757d',
              callback(value) {
                return formatMoney(Math.abs(value));
              },
            },
            grid: {
              color: 'rgba(108,117,125,0.15)',
            },
          },
        },
      },
    });

    wrapper.classList.remove('d-none');
    empty.classList.add('d-none');
  }

  function destroyChart() {
    if (state.chart && typeof state.chart.destroy === 'function') {
      state.chart.destroy();
    }
    state.chart = null;
  }

  function renderPayslipJson(payslip) {
    const pre = byId('payslip-json');
    if (!pre) return;

    if (!payslip) {
      pre.textContent = 'No payslip selected.';
      return;
    }

    try {
      pre.textContent = JSON.stringify(payslip.raw, null, 2);
    } catch (error) {
      console.warn('Failed to stringify payslip JSON', error);
      pre.textContent = 'Unable to render JSON payload.';
    }
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
        amount: (() => {
          const direct = Number(item?.amount);
          if (Number.isFinite(direct)) return direct;
          return pickNumber(item, ['value', 'total', 'gross', 'net']);
        })() || 0,
      }))
      .filter((item) => item.label);
  }

  function normalisePayslipList(entries = []) {
    if (!Array.isArray(entries)) return [];
    const normalised = entries
      .map((entry, index) => normalisePayslipEntry(entry, index))
      .filter((entry) => entry != null);
    normalised.sort((a, b) => (b.payDate?.getTime() || 0) - (a.payDate?.getTime() || 0));
    normalised.forEach((entry, idx) => {
      const baseLabel = entry.periodLabel || entry.payDateLabel || `Payslip ${idx + 1}`;
      const employerLabel = entry.employer ? ` • ${entry.employer}` : '';
      entry.optionLabel = `${baseLabel}${employerLabel}`;
    });
    return normalised;
  }

  function normalisePayslipEntry(entry, fallbackIndex = 0) {
    if (!entry || typeof entry !== 'object') return null;
    const totals = entry.totals || {};
    const payDate = parseDate(entry.payDate) || parseDate(entry.period?.end) || parseDate(entry.period?.payDate);
    const period = entry.period || {};
    const periodLabel = period.label || formatPeriodLabel({ start: period.start, end: period.end, month: period.month });
    const payFrequency = period.frequency || entry.payFrequency || entry.frequency || null;
    const gross = pickNumber(totals, ['gross', 'grossPay', 'grossPeriod']) ?? pickNumber(entry, ['gross', 'grossPay']);
    const net = pickNumber(totals, ['net', 'netPay', 'netPeriod']) ?? pickNumber(entry, ['net', 'netPay']);
    const deductionsTotal = pickNumber(totals, ['deductions', 'totalDeductions'])
      ?? pickNumber(entry, ['totalDeductions', 'tax', 'totalWithholding']);
    const uploadedAt = parseDate(entry.uploadedAt)
      || parseDate(entry.createdAt)
      || parseDate(entry.metadata?.uploadedAt);
    const employer = entry.employer?.name
      || entry.employer
      || entry.metadata?.employer?.name
      || entry.metadata?.employerName
      || null;

    const earnings = normaliseLineItems(entry.earnings || totals.earnings || []);
    const deductions = normaliseLineItems(entry.deductions || totals.deductions || []);

    const id = String(entry.id || entry._id || entry.entryId || `payslip-${fallbackIndex}`);

    const resolvedGross = Number.isFinite(gross) ? Number(gross) : null;
    const resolvedNet = Number.isFinite(net) ? Number(net) : null;
    const resolvedDeductions = Number.isFinite(deductionsTotal)
      ? Number(deductionsTotal)
      : resolvedGross != null && resolvedNet != null
        ? Number(resolvedGross - resolvedNet)
        : null;

    return {
      id,
      employer,
      payDate,
      payDateLabel: formatDateLabel(payDate) || (periodLabel && periodLabel !== '—' ? periodLabel : '—'),
      periodLabel,
      payFrequency: payFrequency ? String(payFrequency) : '—',
      gross: resolvedGross,
      net: resolvedNet,
      deductionsTotal: resolvedDeductions,
      earnings,
      deductions,
      uploadedAt,
      uploadedLabel: formatDateTime(uploadedAt),
      raw: entry,
      optionLabel: '',
    };
  }

  function pickDefaultSelection(list, currentId) {
    if (!Array.isArray(list) || list.length === 0) return null;
    if (currentId && list.some((item) => item.id === currentId)) {
      return currentId;
    }
    return list[0].id;
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
        msg.textContent = 'Add payslips in the document vault to see your earnings analytics populate instantly.';
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

  function formatDateTime(value) {
    const date = parseDate(value);
    if (!date) return '—';
    return date.toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
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
