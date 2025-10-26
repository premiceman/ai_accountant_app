// frontend/js/dashboard.js
(function () {
  const state = {
    payslips: [],
    selectedId: null,
    chart: null,
    statements: [],
    statementSelectedId: null,
    statementChart: null,
  };

  init().catch((error) => {
    console.error('Dashboard failed to initialise', error);
    softError('Unable to load dashboard right now. Please refresh.');
  });

  async function init() {
    const { me } = await Auth.requireAuth();
    Auth.setBannerTitle('Intelligence Dashboard');

    const [insights, payslipDataset, statementDataset] = await Promise.all([
      loadInsights().catch((error) => {
        console.warn('Proceeding without document insights', error);
        return {};
      }),
      loadPayslipDataset(),
      loadStatementDataset(),
    ]);

    renderDashboard({ me, insights, payslipDataset, statementDataset });
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

  async function loadStatementDataset() {
    try {
      const response = await Auth.fetch('/api/analytics/statements', { cache: 'no-store' });
      if (response.status === 404) {
        return { list: [], error: null };
      }
      if (!response.ok) {
        const text = await safeRead(response);
        throw new Error(text || `Request failed (${response.status})`);
      }
      const payload = await response.json();
      const list = Array.isArray(payload?.statements)
        ? payload.statements
        : Array.isArray(payload)
          ? payload
          : [];
      return { list, error: null };
    } catch (error) {
      console.error('Failed to load statement dataset', error);
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

  function renderDashboard({ insights = {}, payslipDataset = { list: [] }, statementDataset = { list: [] }, me = null } = {}) {
    if (me?.firstName) {
      const greeting = byId('greeting-name');
      if (greeting) greeting.textContent = me.firstName;
    }

    const { list: rawPayslips = [], error: payslipError = null } = payslipDataset || {};
    const payslips = normalisePayslipList(rawPayslips);

    const { list: rawStatements = [], error: statementError = null } = statementDataset || {};
    const statements = normaliseStatementList(rawStatements);

    if (!payslips.length && !statements.length) {
      if (payslipError && statementError) {
        softError('Unable to load document analytics right now. Please refresh.');
      } else if (payslipError) {
        softError('Unable to load payslip data right now. Please refresh.');
      } else if (statementError) {
        softError('Unable to load statement data right now. Please refresh.');
      }
    }

    toggleDashboardEmpty(!(payslips.length || statements.length));

    state.payslips = payslips;
    state.selectedId = pickDefaultSelection(payslips, state.selectedId);

    renderPayslipSelector(payslips, state.selectedId);
    const selectedPayslip = getSelectedPayslip();
    renderPayslipSummary(selectedPayslip);
    renderHistogram(selectedPayslip);
    renderPayslipJson(selectedPayslip);

    state.statements = statements;
    state.statementSelectedId = pickDefaultSelection(statements, state.statementSelectedId);

    renderStatementSelector(statements, state.statementSelectedId);
    const selectedStatement = getSelectedStatement();
    renderStatementSummary(selectedStatement);
    renderStatementChart(selectedStatement);
    renderStatementCategories(selectedStatement);
    renderStatementJson(selectedStatement);
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
      setText('payslip-tax-code', '—');
      setText('payslip-earnings-ytd', '£—');
      setText('payslip-deductions-ytd', '£—');
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
    setText('payslip-tax-code', payslip.taxCode || '—');
    setText(
      'payslip-earnings-ytd',
      formatMoney(Number.isFinite(payslip.earningsYtdTotal) ? payslip.earningsYtdTotal : undefined),
    );
    setText(
      'payslip-deductions-ytd',
      formatMoney(Number.isFinite(payslip.deductionsYtdTotal) ? payslip.deductionsYtdTotal : undefined),
    );
    setText('payslip-gross', formatMoney(Number.isFinite(payslip.gross) ? payslip.gross : undefined));
    setText('payslip-net', formatMoney(Number.isFinite(payslip.net) ? payslip.net : undefined));
    setText(
      'payslip-deductions',
      formatMoney(Number.isFinite(payslip.deductionsTotal) ? payslip.deductionsTotal : undefined),
    );
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

  function renderStatementSelector(statements, selectedId) {
    const select = byId('statement-selector');
    if (!select) return;

    select.innerHTML = '';

    if (!Array.isArray(statements) || statements.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No statements available';
      select.appendChild(option);
      select.disabled = true;
      return;
    }

    statements.forEach((statement) => {
      const option = document.createElement('option');
      option.value = statement.id;
      option.textContent = statement.optionLabel;
      select.appendChild(option);
    });

    select.disabled = false;
    select.value = selectedId || statements[0]?.id || '';

    if (!select.dataset.bound) {
      select.addEventListener('change', (event) => {
        const id = event.target.value || null;
        state.statementSelectedId = id;
        const selected = getSelectedStatement();
        renderStatementSummary(selected);
        renderStatementChart(selected);
        renderStatementCategories(selected);
        renderStatementJson(selected);
      });
      select.dataset.bound = 'true';
    }
  }

  function getSelectedStatement() {
    if (!state.statementSelectedId) return null;
    return state.statements.find((item) => item.id === state.statementSelectedId) || null;
  }

  function renderStatementSummary(statement) {
    const empty = byId('statement-empty');
    const content = byId('statement-content');

    if (!statement) {
      content?.classList.add('d-none');
      if (empty) {
        empty.textContent = 'Upload a bank statement or choose one from the selector to review incomings, outgoings and balances.';
        empty.classList.remove('d-none');
      }
      setText('statement-institution', '—');
      setText('statement-account', '—');
      setText('statement-period', '—');
      setText('statement-money-in', '£—');
      setText('statement-money-out', '£—');
      setText('statement-net', '£—');
      setText('statement-opening-balance', '£—');
      setText('statement-closing-balance', '£—');
      setText('statement-uploaded', '—');
      renderTransactionsTable(byId('statement-transactions-body'), []);
      return;
    }

    empty?.classList.add('d-none');
    content?.classList.remove('d-none');

    const institutionLabel = statement.institutionName || '—';
    const accountParts = [];
    if (statement.accountName) accountParts.push(statement.accountName);
    if (statement.accountNumberMasked) accountParts.push(statement.accountNumberMasked);

    setText('statement-institution', institutionLabel);
    setText('statement-account', accountParts.length ? accountParts.join(' • ') : '—');
    setText('statement-period', statement.periodLabel || '—');
    setText('statement-money-in', formatMoney(statement.moneyIn));
    setText('statement-money-out', formatMoney(statement.moneyOut));
    setText('statement-net', formatMoney(statement.net, { sign: true }));
    setText('statement-opening-balance', formatMoney(statement.openingBalance));
    setText('statement-closing-balance', formatMoney(statement.closingBalance));
    setText('statement-uploaded', statement.uploadedLabel || '—');

    const tbody = byId('statement-transactions-body');
    const topTransactions = statement.transactions
      .slice()
      .sort((a, b) => Math.abs(b.amount || 0) - Math.abs(a.amount || 0))
      .slice(0, 10);
    renderTransactionsTable(tbody, topTransactions);
  }

  function renderStatementChart(statement) {
    const empty = byId('statement-chart-empty');
    const wrapper = byId('statement-chart-wrapper');
    const canvas = byId('statement-chart');
    if (!empty || !wrapper || !canvas) return;

    const defaultMessage = 'Select a statement to view spending by category.';

    if (!statement) {
      destroyStatementChart();
      wrapper.classList.add('d-none');
      empty.classList.remove('d-none');
      if (!empty.textContent) empty.textContent = defaultMessage;
      else empty.textContent = defaultMessage;
      return;
    }

    const categories = Array.isArray(statement.spendCategories)
      ? statement.spendCategories.filter((item) => Number(item.amount) > 0)
      : [];

    if (!categories.length) {
      destroyStatementChart();
      wrapper.classList.add('d-none');
      empty.classList.remove('d-none');
      empty.textContent = 'No spending categories available for this statement.';
      return;
    }

    if (typeof window.Chart === 'undefined') {
      console.warn('Chart.js is not available.');
      destroyStatementChart();
      wrapper.classList.add('d-none');
      empty.classList.remove('d-none');
      empty.textContent = 'Chart library unavailable. Install Chart.js to view the pie chart.';
      return;
    }

    destroyStatementChart();

    const labels = categories.map((item) => item.label);
    const data = categories.map((item) => Math.abs(item.amount || 0));
    const ctx = canvas.getContext('2d');
    const computedStyle = getComputedStyle(document.documentElement);
    const muted = computedStyle.getPropertyValue('--bs-secondary-color') || '#6c757d';
    const borderColor = computedStyle.getPropertyValue('--bs-border-color-translucent') || 'rgba(108,117,125,0.2)';
    const colors = buildChartPalette(labels.length);

    state.statementChart = new window.Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [
          {
            label: 'Spending by category',
            data,
            backgroundColor: colors,
            borderColor,
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '55%',
        plugins: {
          legend: {
            labels: {
              color: muted || '#6c757d',
            },
          },
          tooltip: {
            callbacks: {
              label(context) {
                const label = context.label || '';
                const value = Number(context.parsed);
                const category = categories[context.dataIndex];
                const share = category?.share;
                const shareLabel = Number.isFinite(share) ? ` (${formatPercent(share)})` : '';
                return `${label}: ${formatMoney(value)}${shareLabel}`;
              },
            },
          },
        },
      },
    });

    wrapper.classList.remove('d-none');
    empty.classList.add('d-none');
  }

  function destroyStatementChart() {
    if (state.statementChart && typeof state.statementChart.destroy === 'function') {
      state.statementChart.destroy();
    }
    state.statementChart = null;
  }

  function buildChartPalette(count) {
    const basePalette = [
      'rgba(103,89,255,0.85)',
      'rgba(16,185,129,0.85)',
      'rgba(245,158,11,0.85)',
      'rgba(239,68,68,0.85)',
      'rgba(59,130,246,0.85)',
      'rgba(236,72,153,0.85)',
      'rgba(20,184,166,0.85)',
      'rgba(249,115,22,0.85)',
      'rgba(37,99,235,0.85)',
      'rgba(147,51,234,0.85)',
    ];
    if (!count || count <= basePalette.length) {
      return basePalette.slice(0, Math.max(0, count));
    }
    const colors = [];
    for (let index = 0; index < count; index += 1) {
      colors.push(basePalette[index % basePalette.length]);
    }
    return colors;
  }

  function renderStatementCategories(statement) {
    const tbody = byId('statement-categories-body');
    if (!tbody) return;

    clearTable(tbody);

    const categories = Array.isArray(statement?.spendCategories)
      ? statement.spendCategories.filter((item) => Number(item.amount) > 0)
      : [];

    if (!categories.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="3" class="text-muted small">No spending categories available.</td>';
      tbody.appendChild(tr);
      return;
    }

    categories.forEach((item) => {
      const tr = document.createElement('tr');
      const label = escapeHtml(item.label || 'Category');
      tr.innerHTML = `
        <td>${label}</td>
        <td class="text-end">${formatMoney(item.amount)}</td>
        <td class="text-end">${formatPercent(item.share)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderStatementJson(statement) {
    const pre = byId('statement-json');
    if (!pre) return;

    if (!statement) {
      pre.textContent = 'No statement selected.';
      return;
    }

    try {
      pre.textContent = JSON.stringify(statement.raw, null, 2);
    } catch (error) {
      console.warn('Failed to stringify statement JSON', error);
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

  function renderTransactionsTable(tbody, transactions) {
    if (!tbody) return;
    clearTable(tbody);
    if (!Array.isArray(transactions) || !transactions.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="3" class="text-muted small">No transactions available.</td>';
      tbody.appendChild(tr);
      return;
    }

    transactions.forEach((tx) => {
      const tr = document.createElement('tr');
      const description = escapeHtml(tx.description || 'Transaction');
      const dateLabel = tx.date ? formatDateLabel(tx.date) : '—';
      tr.innerHTML = `
        <td>${description}</td>
        <td>${dateLabel || '—'}</td>
        <td class="text-end">${formatMoney(tx.amount, { sign: true })}</td>`;
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
        amountYtd: (() => {
          const ytd = pickNumber(item, [
            'amountYtd',
            'amountYearToDate',
            'ytd',
            'valueYtd',
            'totalYtd',
            'yearToDate',
          ]);
          return Number.isFinite(ytd) ? Number(ytd) : null;
        })(),
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

    const earningsYtdSum = sumYtdValues(earnings);
    const deductionsYtdSum = sumYtdValues(deductions);
    const earningsYtdTotal =
      earningsYtdSum
      ?? pickNumber(totals, ['grossYtd', 'earningsYtd', 'totalEarningsYtd', 'grossYearToDate'])
      ?? pickNumber(entry, ['grossYtd', 'earningsYtd', 'totalEarningsYtd', 'grossYearToDate']);
    const deductionsYtdTotal =
      deductionsYtdSum
      ?? pickNumber(totals, ['deductionsYtd', 'totalDeductionsYtd', 'withholdingYtd', 'deductionsYearToDate'])
      ?? pickNumber(entry, ['deductionsYtd', 'totalDeductionsYtd', 'withholdingYtd', 'deductionsYearToDate']);

    const metadata = entry.metadata || entry.meta || {};
    const employee = entry.employee || metadata.employee || {};
    const taxCode = [
      entry.taxCode,
      totals.taxCode,
      employee.taxCode,
      employee.taxCodeCurrent,
      metadata.taxCode,
      metadata.taxCodeCurrent,
      metadata.employee?.taxCode,
      metadata.employee?.taxCodeCurrent,
    ].find((value) => typeof value === 'string' && value.trim().length > 0) || null;

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
      earningsYtdTotal: Number.isFinite(earningsYtdTotal) ? Number(earningsYtdTotal) : null,
      deductionsYtdTotal: Number.isFinite(deductionsYtdTotal) ? Math.abs(Number(deductionsYtdTotal)) : null,
      taxCode,
      uploadedAt,
      uploadedLabel: formatDateTime(uploadedAt),
      raw: entry,
      optionLabel: '',
    };
  }

  function normaliseStatementList(entries = []) {
    if (!Array.isArray(entries)) return [];
    const normalised = entries
      .map((entry, index) => normaliseStatementEntry(entry, index))
      .filter((entry) => entry != null);
    normalised.sort((a, b) => {
      const aDate = a.periodEnd || a.periodStart || null;
      const bDate = b.periodEnd || b.periodStart || null;
      return (bDate?.getTime() || 0) - (aDate?.getTime() || 0);
    });
    normalised.forEach((entry, idx) => {
      const baseLabel = entry.periodLabel && entry.periodLabel !== '—'
        ? entry.periodLabel
        : `Statement ${idx + 1}`;
      const accountParts = [entry.accountName, entry.institutionName].filter(Boolean);
      entry.optionLabel = accountParts.length ? `${baseLabel} • ${accountParts.join(' • ')}` : baseLabel;
    });
    return normalised;
  }

  function normaliseStatementEntry(entry, fallbackIndex = 0) {
    if (!entry || typeof entry !== 'object') return null;
    const id = String(entry.id || entry.fileId || entry.insightId || `statement-${fallbackIndex}`);
    const totals = entry.totals || {};
    const balances = entry.balances || {};
    const period = entry.period || {};

    const moneyIn = pickNumber(totals, ['moneyIn', 'totalIn', 'income']);
    const moneyOut = pickNumber(totals, ['moneyOut', 'totalOut', 'spend']);
    let net = pickNumber(totals, ['net']);
    if (net == null && Number.isFinite(moneyIn) && Number.isFinite(moneyOut)) {
      net = Number(moneyIn) - Number(moneyOut);
    }

    const openingBalance = pickNumber(balances, ['opening', 'openingBalance']);
    const closingBalance = pickNumber(balances, ['closing', 'closingBalance']);

    const periodStart = parseDate(period.start);
    const periodEnd = parseDate(period.end);
    const periodLabel = period.label || formatPeriodLabel({ start: period.start, end: period.end, month: period.month });
    const uploadedAt = parseDate(entry.uploadedAt);

    const transactions = normaliseStatementTransactions(entry.transactions);
    const spendCategories = normaliseStatementCategories(entry.categories);

    return {
      id,
      accountName: entry.accountName || 'Account',
      institutionName: entry.institutionName || null,
      accountNumberMasked: entry.accountNumberMasked || null,
      accountType: entry.accountType || null,
      moneyIn: Number.isFinite(moneyIn) ? Number(moneyIn) : null,
      moneyOut: Number.isFinite(moneyOut) ? Number(moneyOut) : null,
      net: Number.isFinite(net) ? Number(net) : null,
      openingBalance: Number.isFinite(openingBalance) ? Number(openingBalance) : null,
      closingBalance: Number.isFinite(closingBalance) ? Number(closingBalance) : null,
      periodStart,
      periodEnd,
      periodLabel: periodLabel || '—',
      uploadedAt,
      uploadedLabel: formatDateTime(uploadedAt),
      transactions,
      spendCategories,
      raw: entry.raw || entry,
      currency: entry.currency || 'GBP',
      optionLabel: '',
    };
  }

  function normaliseStatementTransactions(list) {
    if (!Array.isArray(list)) return [];
    return list
      .map((item, index) => {
        if (!item || typeof item !== 'object') return null;
        const amountRaw = Number(item.amount);
        if (!Number.isFinite(amountRaw)) return null;
        const directionRaw = String(item.direction || '').toLowerCase();
        const direction = directionRaw === 'outflow'
          ? 'outflow'
          : directionRaw === 'inflow'
            ? 'inflow'
            : amountRaw < 0
              ? 'outflow'
              : 'inflow';
        const signedAmount = direction === 'outflow' ? -Math.abs(amountRaw) : Math.abs(amountRaw);
        const date = parseDate(item.date);
        return {
          id: String(item.id || item.transactionId || `statement-tx-${index}`),
          description: item.description || item.label || item.memo || 'Transaction',
          category: item.category || 'Other',
          amount: signedAmount,
          direction,
          date,
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));
  }

  function normaliseStatementCategories(list) {
    if (!Array.isArray(list)) return [];
    const mapped = list
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const amountRaw = pickNumber(item, ['amount', 'outflow']);
        if (!Number.isFinite(amountRaw)) return null;
        const label = item.label || item.category || 'Category';
        const shareRaw = pickNumber(item, ['share']);
        return {
          label,
          category: item.category || label,
          amount: Math.abs(Number(amountRaw)),
          share: Number.isFinite(shareRaw) ? Number(shareRaw) : null,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.amount - a.amount);

    const total = mapped.reduce((sum, item) => sum + (Number.isFinite(item.amount) ? item.amount : 0), 0);
    return mapped.map((item) => ({
      ...item,
      share: Number.isFinite(item.share) ? item.share : total ? item.amount / total : null,
    }));
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
        msg.textContent = 'Add payslips or bank statements in the document vault to see your analytics populate instantly.';
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

  function sumYtdValues(items) {
    if (!Array.isArray(items) || !items.length) return null;
    let total = 0;
    let hasValue = false;
    items.forEach((item) => {
      const value = Number(item?.amountYtd);
      if (Number.isFinite(value)) {
        total += Math.abs(value);
        hasValue = true;
      }
    });
    return hasValue ? total : null;
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

  function formatPercent(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '—';
    const pct = num * 100;
    const decimals = Math.abs(pct) >= 10 ? 1 : 2;
    return `${pct.toFixed(decimals)}%`;
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
