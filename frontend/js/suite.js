(() => {
  const pipelineOrder = ['Uploaded', 'Queued', 'Classified', 'Standardized', 'Post-Processed', 'Indexed', 'Ready'];
  const requiredDocs = [
    { key: 'p60', label: 'P60' },
    { key: 'p45', label: 'P45 / starter checklist' },
    { key: 'bank_statement', label: 'Bank statements' },
    { key: 'id', label: 'Photo ID' },
    { key: 'utr', label: 'UTR or HMRC letter' },
  ];

  const els = {
    navItems: () => Array.from(document.querySelectorAll('[data-nav-target]')),
    sections: () => Array.from(document.querySelectorAll('[data-section]')),
    ribbon: document.getElementById('suite-processing-ribbon'),
    documentsBody: document.getElementById('vault-table-body'),
    documentsEmpty: document.getElementById('vault-empty'),
    uploadButton: document.getElementById('vault-upload-button'),
    refreshButton: document.getElementById('vault-refresh'),
    loadMoreButton: document.getElementById('vault-load-more'),
    fileInput: document.getElementById('vault-file-input'),
    dropzone: document.getElementById('vault-dropzone'),
    uploadQueue: document.getElementById('vault-upload-queue'),
    previewModal: document.getElementById('vault-preview-modal'),
    previewBody: document.getElementById('vault-preview-body'),
    previewTitle: document.getElementById('vault-preview-title'),
    globalError: document.getElementById('suite-global-error'),
    globalErrorMessage: document.getElementById('suite-global-error-message'),
    globalRetry: document.getElementById('suite-global-retry'),
    toasts: document.getElementById('suite-toasts'),
    overviewLoading: document.getElementById('overview-loading'),
    overviewContent: document.getElementById('overview-content'),
    overviewKpis: document.getElementById('overview-kpis'),
    overviewStatus: document.getElementById('overview-status'),
    incomeLoading: document.getElementById('income-loading'),
    incomeContent: document.getElementById('income-content'),
    incomeTableBody: document.getElementById('income-table-body'),
    incomeEmpty: document.getElementById('income-empty'),
    incomeTotalCount: document.getElementById('income-total-count'),
    incomeSourceList: document.getElementById('income-source-list'),
    spendingLoading: document.getElementById('spending-loading'),
    spendingContent: document.getElementById('spending-content'),
    spendingCategoryTiles: document.getElementById('spending-category-tiles'),
    spendingMerchantBody: document.getElementById('spending-merchant-body'),
    spendingMerchantEmpty: document.getElementById('spending-merchant-empty'),
    spendingAnomalies: document.getElementById('spending-anomalies'),
    taxLoading: document.getElementById('tax-loading'),
    taxContent: document.getElementById('tax-content'),
    taxYtdList: document.getElementById('tax-ytd-list'),
    taxChecklist: document.getElementById('tax-checklist'),
    wealthLoading: document.getElementById('wealth-loading'),
    wealthContent: document.getElementById('wealth-content'),
    wealthEmpty: document.getElementById('wealth-empty'),
    wealthSavingsRate: document.getElementById('wealth-savings-rate'),
    wealthRunway: document.getElementById('wealth-runway'),
    wealthRunwayCaption: document.getElementById('wealth-runway-caption'),
    wealthBalances: document.getElementById('wealth-balances'),
    userMeta: document.getElementById('suite-user-meta'),
    incomeDetailPanel: document.getElementById('income-detail-panel'),
    incomeDetailTitle: document.getElementById('income-detail-title'),
    incomeDetailPeriod: document.getElementById('income-detail-period'),
    incomeDetailMetrics: document.getElementById('income-detail-metrics'),
    incomeDetailEarnings: document.getElementById('income-detail-earnings'),
    incomeDetailDeductions: document.getElementById('income-detail-deductions'),
    incomeDetailJson: document.getElementById('income-detail-json'),
  };

  const state = {
    documents: [],
    documentPage: 1,
    hasMoreDocuments: false,
    documentLoading: false,
    documentStatusMap: new Map(),
    uploading: new Map(),
    overview: null,
    overviewSeries: null,
    payslips: [],
    statements: [],
    charts: {},
    jobStream: null,
    jobReconnectTimer: null,
    privacyMode: detectPrivacyMode(),
  };

  let offcanvasInstance = null;

  document.addEventListener('DOMContentLoaded', () => {
    init().catch((error) => {
      console.error('Suite initialisation failed', error);
      showGlobalError('Unable to load the control center. Please retry.');
    });
  });

  async function init() {
    if (!window.Auth || typeof Auth.requireAuth !== 'function') {
      throw new Error('Authentication helpers unavailable');
    }

    const { me } = await Auth.requireAuth();
    hydrateUserMeta(me);

    bindNav();
    bindUpload();
    bindGlobalHandlers();
    bindIncomeDetail();

    await loadAll();
    startJobStream();
  }

  async function loadAll() {
    hideGlobalError();
    setOverviewLoading(true);
    setIncomeLoading(true);
    setSpendingLoading(true);
    setTaxLoading(true);
    setWealthLoading(true);
    await Promise.all([
      fetchDocuments({ reset: true }),
      loadAnalytics(),
    ]).catch((error) => {
      console.error('Failed to load data', error);
      showGlobalError('We could not load data from the API. Please retry.');
    });
  }

  function bindGlobalHandlers() {
    els.globalRetry?.addEventListener('click', () => {
      loadAll().catch((error) => {
        console.error('Retry failed', error);
        showGlobalError('Retry failed. Please check your connection and try again.');
      });
    });

    const signout = document.getElementById('nav-signout');
    if (signout) {
      signout.addEventListener('click', (event) => {
        event.preventDefault();
        try {
          if (window.Auth && typeof Auth.signOut === 'function') {
            Auth.signOut({ reason: 'control-center' });
          }
        } catch (error) {
          console.warn('Sign out failed', error);
        }
      });
    }

    window.addEventListener('scroll', handleScrollActiveNav, { passive: true });
    handleScrollActiveNav();

    window.addEventListener('error', (event) => {
      if (!event?.message) return;
      showToast(`Error: ${event.message}`, 'danger');
    });
    window.addEventListener('unhandledrejection', (event) => {
      if (event?.reason) {
        const message = event.reason?.message || event.reason;
        showToast(`Request failed: ${message}`, 'danger');
      }
    });
  }

  function bindNav() {
    els.navItems().forEach((button) => {
      button.addEventListener('click', () => {
        const targetId = button.getAttribute('data-nav-target');
        if (!targetId) return;
        const target = document.getElementById(targetId);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  }

  function bindUpload() {
    els.uploadButton?.addEventListener('click', () => els.fileInput?.click());
    els.refreshButton?.addEventListener('click', () => fetchDocuments({ reset: true }));
    els.fileInput?.addEventListener('change', (event) => {
      const { files } = event.target;
      handleFiles(files);
      event.target.value = '';
    });
    if (els.dropzone) {
      ['dragenter', 'dragover'].forEach((type) => {
        els.dropzone.addEventListener(type, (event) => {
          event.preventDefault();
          event.stopPropagation();
          els.dropzone.classList.add('dragover');
        });
      });
      ['dragleave', 'dragend'].forEach((type) => {
        els.dropzone.addEventListener(type, (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!event.currentTarget.contains(event.relatedTarget)) {
            els.dropzone.classList.remove('dragover');
          }
        });
      });
      els.dropzone.addEventListener('drop', (event) => {
        event.preventDefault();
        event.stopPropagation();
        els.dropzone.classList.remove('dragover');
        const files = event.dataTransfer?.files;
        handleFiles(files);
      });
      els.dropzone.addEventListener('click', () => {
        els.fileInput?.click();
      });
    }

    els.loadMoreButton?.addEventListener('click', () => {
      fetchDocuments({ reset: false });
    });
  }

  function bindIncomeDetail() {
    if (els.incomeDetailPanel && window.bootstrap?.Offcanvas) {
      offcanvasInstance = window.bootstrap.Offcanvas.getOrCreateInstance(els.incomeDetailPanel);
    }
  }

  async function loadAnalytics() {
    try {
      const [overview, series, payslips, statements] = await Promise.all([
        fetchOverview(),
        fetchSeries(),
        fetchPayslips(),
        fetchStatements(),
      ]);
      state.overview = overview;
      state.overviewSeries = series;
      state.payslips = payslips;
      state.statements = statements;
      renderOverview();
      renderIncome();
      renderSpending();
      renderTax();
      renderWealth();
    } catch (error) {
      console.error('Analytics load failed', error);
      showGlobalError('Analytics services are temporarily unavailable. Please retry.');
    }
  }

  async function fetchOverview() {
    try {
      const res = await Auth.fetch('/api/analytics/overview', { cache: 'no-store' });
      if (res.status === 404) {
        setOverviewLoading(false);
        return null;
      }
      if (!res.ok) throw new Error(`Overview ${res.status}`);
      return res.json();
    } catch (error) {
      setOverviewLoading(false);
      throw error;
    }
  }

  async function fetchSeries() {
    const res = await Auth.fetch('/api/analytics/series?range=6m', { cache: 'no-store' });
    if (!res.ok) throw new Error(`Series ${res.status}`);
    return res.json();
  }

  async function fetchPayslips() {
    try {
      const res = await Auth.fetch('/api/analytics/payslips', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Payslips ${res.status}`);
      const data = await res.json();
      return Array.isArray(data?.payslips) ? data.payslips : [];
    } catch (error) {
      showToast('Unable to load payslip analytics.', 'warning');
      return [];
    }
  }

  async function fetchStatements() {
    try {
      const res = await Auth.fetch('/api/analytics/statements', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Statements ${res.status}`);
      const data = await res.json();
      return Array.isArray(data?.statements) ? data.statements : [];
    } catch (error) {
      showToast('Unable to load statement analytics.', 'warning');
      return [];
    }
  }

  async function fetchDocuments({ reset = false } = {}) {
    if (state.documentLoading) return;
    state.documentLoading = true;
    if (reset) state.documentPage = 1;
    setDocumentTableLoading(true, { reset });
    try {
      const params = new URLSearchParams({ page: String(state.documentPage), limit: '20' });
      const res = await Auth.fetch(`/api/vault/list?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Vault ${res.status}`);
      const data = await res.json();
      const items = Array.isArray(data?.items) ? data.items : [];
      state.hasMoreDocuments = Boolean(data?.hasMore);
      state.documentPage = (data?.page || state.documentPage) + 1;
      state.documents = reset ? items : state.documents.concat(items);
      updateDocumentStatusMap();
      renderDocuments();
      renderRibbon();
      updateOverviewStatus();
    } catch (error) {
      console.error('Failed to fetch documents', error);
      showToast('Unable to load documents. Please retry.', 'danger');
    } finally {
      state.documentLoading = false;
      setDocumentTableLoading(false, { reset });
    }
  }

  function updateDocumentStatusMap() {
    state.documentStatusMap.clear();
    state.documents.forEach((doc) => {
      const status = doc?.job?.status || doc?.status || 'uploaded';
      state.documentStatusMap.set(doc.id, status);
    });
  }

  function setDocumentTableLoading(isLoading, { reset = false } = {}) {
    const body = els.documentsBody;
    if (!body) return;
    if (isLoading && reset) {
      body.innerHTML = '';
      for (let i = 0; i < 4; i += 1) {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td class="px-4">
            <span class="placeholder col-8"></span>
            <div class="small text-secondary"><span class="placeholder col-4"></span></div>
          </td>
          <td><span class="placeholder col-4"></span></td>
          <td><span class="placeholder col-5"></span></td>
          <td><span class="placeholder col-7"></span></td>
          <td class="text-end pe-4"><span class="placeholder col-3"></span></td>`;
        body.appendChild(row);
      }
    }
  }

  function renderDocuments() {
    const body = els.documentsBody;
    if (!body) return;
    body.innerHTML = '';

    if (!state.documents.length) {
      els.documentsEmpty?.classList.remove('d-none');
      els.loadMoreButton?.setAttribute('hidden', 'hidden');
      return;
    }
    els.documentsEmpty?.classList.add('d-none');

    state.documents.forEach((doc) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="px-4">
          <div class="fw-semibold text-truncate" title="${escapeHtml(doc.filename)}">${escapeHtml(doc.filename)}</div>
          <small class="text-secondary">${escapeHtml(doc.fileType || 'application/pdf')}</small>
        </td>
        <td>${formatBytes(doc.fileSize)}</td>
        <td>${formatDateTime(doc.uploadedAt)}</td>
        <td></td>
        <td class="text-end pe-4">
          <div class="btn-group btn-group-sm" role="group">
            <button type="button" class="btn btn-outline-secondary" data-action="preview" aria-label="Preview ${escapeHtml(doc.filename)}"><i class="bi bi-eye"></i></button>
            <button type="button" class="btn btn-outline-primary" data-action="download" aria-label="Download ${escapeHtml(doc.filename)}"><i class="bi bi-download"></i></button>
            <button type="button" class="btn btn-outline-danger" data-action="delete" aria-label="Delete ${escapeHtml(doc.filename)}"><i class="bi bi-trash"></i></button>
          </div>
        </td>`;
      const statusCell = tr.children[3];
      statusCell.appendChild(buildStatusChips(doc));
      tr.querySelector('[data-action="preview"]').addEventListener('click', () => handlePreview(doc));
      tr.querySelector('[data-action="download"]').addEventListener('click', () => handleDownload(doc));
      tr.querySelector('[data-action="delete"]').addEventListener('click', () => handleDelete(doc));
      body.appendChild(tr);
    });

    if (state.hasMoreDocuments) {
      els.loadMoreButton?.removeAttribute('hidden');
    } else {
      els.loadMoreButton?.setAttribute('hidden', 'hidden');
    }
  }

  function buildStatusChips(doc) {
    const wrapper = document.createElement('div');
    wrapper.className = 'suite-status-chips d-flex flex-wrap gap-1';
    const steps = deriveSteps(doc);
    steps.forEach((step) => {
      const span = document.createElement('span');
      span.className = `badge rounded-pill ${chipClass(step.status)}`;
      span.textContent = step.name;
      wrapper.appendChild(span);
    });
    return wrapper;
  }

  function deriveSteps(doc) {
    const jobSteps = Array.isArray(doc?.job?.steps) ? doc.job.steps : [];
    const stepMap = new Map(jobSteps.map((step) => [step.name, step]));
    const steps = pipelineOrder.map((name) => {
      const match = stepMap.get(name);
      if (match) return { ...match };
      return { name, status: name === 'Uploaded' ? 'completed' : name === 'Queued' ? 'running' : 'pending' };
    });
    const final = steps[steps.length - 1];
    const docStatus = doc?.status || doc?.job?.status;
    if (docStatus === 'failed') {
      steps.forEach((step) => {
        if (step.status !== 'completed') step.status = 'failed';
      });
      final.status = 'failed';
    } else if (docStatus === 'ready' || doc?.job?.status === 'completed') {
      steps.forEach((step) => {
        step.status = 'completed';
      });
    }
    return steps;
  }

  function chipClass(status) {
    switch (status) {
      case 'completed':
        return 'bg-success-subtle text-success-emphasis';
      case 'running':
        return 'bg-info-subtle text-info-emphasis';
      case 'failed':
        return 'bg-danger-subtle text-danger-emphasis';
      default:
        return 'bg-body-tertiary text-secondary';
    }
  }

  function renderRibbon() {
    const ribbon = els.ribbon;
    if (!ribbon) return;
    const processing = state.documents.filter((doc) => {
      const status = doc?.status || doc?.job?.status;
      return status && !['ready', 'completed'].includes(status);
    });
    if (!processing.length) {
      ribbon.classList.add('d-none');
      ribbon.innerHTML = '';
      return;
    }
    const blocks = processing.slice(0, 4).map((doc) => {
      const steps = deriveSteps(doc);
      const items = steps.map((step) => `<span class="badge rounded-pill ${chipClass(step.status)}">${escapeHtml(step.name)}</span>`).join(' ');
      return `
        <div class="suite-ribbon-item">
          <div class="fw-semibold text-truncate" title="${escapeHtml(doc.filename)}">${escapeHtml(doc.filename)}</div>
          <div class="d-flex flex-wrap gap-1">${items}</div>
        </div>`;
    });
    ribbon.innerHTML = `<div class="suite-ribbon-inner">${blocks.join('')}</div>`;
    ribbon.classList.remove('d-none');
  }

  function setOverviewLoading(isLoading) {
    if (isLoading) {
      els.overviewLoading?.classList.remove('d-none');
      els.overviewContent?.classList.add('d-none');
    } else {
      els.overviewLoading?.classList.add('d-none');
      els.overviewContent?.classList.remove('d-none');
    }
  }

  function renderOverview() {
    const overview = state.overview;
    if (!overview) {
      setOverviewLoading(false);
      return;
    }
    setOverviewLoading(false);
    renderKpis(overview);
    renderOverviewCharts();
    updateOverviewStatus();
  }

  function renderKpis(overview) {
    const container = els.overviewKpis;
    if (!container) return;
    container.innerHTML = '';
    const income = overview?.metrics?.income?.total ?? null;
    const spend = overview?.metrics?.spend?.total ?? null;
    const net = overview?.metrics?.cashflow?.net ?? null;
    const savingsRate = overview?.metrics?.savingsRatePct ?? null;

    const items = [
      { label: 'Income', value: income, format: 'currency', icon: 'bi-cash-coin' },
      { label: 'Spend', value: spend, format: 'currency', icon: 'bi-credit-card' },
      { label: 'Net cashflow', value: net, format: 'currency', icon: 'bi-arrow-left-right' },
      { label: 'Savings rate', value: savingsRate, format: 'percent', icon: 'bi-graph-up' },
    ];

    items.forEach((item) => {
      const col = document.createElement('div');
      col.className = 'col-12 col-md-3';
      col.innerHTML = `
        <div class="suite-card card shadow-sm h-100">
          <div class="card-body">
            <div class="d-flex align-items-center justify-content-between">
              <div>
                <div class="text-secondary text-uppercase small">${escapeHtml(item.label)}</div>
                <div class="h4 mb-0">${formatValue(item.value, item.format)}</div>
              </div>
              <div class="suite-kpi-icon" aria-hidden="true"><i class="bi ${item.icon}"></i></div>
            </div>
          </div>
        </div>`;
      container.appendChild(col);
    });
  }

  function renderOverviewCharts() {
    const months = Array.isArray(state.overviewSeries?.months) ? state.overviewSeries.months : [];
    const incomeSeries = Array.isArray(state.overviewSeries?.income) ? state.overviewSeries.income : [];
    const spendSeries = Array.isArray(state.overviewSeries?.spend) ? state.overviewSeries.spend : [];
    const netSeries = Array.isArray(state.overviewSeries?.net) ? state.overviewSeries.net : [];

    const incomeValues = months.map((month) => {
      const entry = incomeSeries.find((item) => item.month === month);
      return entry ? entry.total || 0 : 0;
    });
    const spendValues = months.map((month) => {
      const entry = spendSeries.find((item) => item.month === month);
      return entry ? entry.total || 0 : 0;
    });
    const netValues = months.map((month) => {
      const entry = netSeries.find((item) => item.month === month);
      return entry ? entry.total || 0 : 0;
    });

    renderChart('overview-income-spend-chart', {
      type: 'bar',
      data: {
        labels: months.map(formatMonthLabel),
        datasets: [
          { label: 'Income', backgroundColor: 'rgba(25, 135, 84, 0.7)', data: incomeValues },
          { label: 'Spend', backgroundColor: 'rgba(220, 53, 69, 0.7)', data: spendValues },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            ticks: {
              callback: (value) => formatCurrency(value),
            },
          },
        },
      },
    });

    renderChart('overview-net-chart', {
      type: 'line',
      data: {
        labels: months.map(formatMonthLabel),
        datasets: [
          {
            label: 'Net cashflow',
            borderColor: 'rgba(13, 110, 253, 0.9)',
            backgroundColor: 'rgba(13, 110, 253, 0.2)',
            tension: 0.3,
            data: netValues,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            ticks: {
              callback: (value) => formatCurrency(value),
            },
          },
        },
      },
    });
  }

  function updateOverviewStatus() {
    const banner = els.overviewStatus;
    if (!banner) return;
    const hasProcessing = state.documents.some((doc) => {
      const status = doc?.status || doc?.job?.status;
      return status && !['ready', 'completed'].includes(status);
    });
    if (hasProcessing) {
      banner.classList.remove('d-none');
    } else {
      banner.classList.add('d-none');
    }
  }

  function setIncomeLoading(isLoading) {
    if (isLoading) {
      els.incomeLoading?.classList.remove('d-none');
      els.incomeContent?.classList.add('d-none');
    } else {
      els.incomeLoading?.classList.add('d-none');
      els.incomeContent?.classList.remove('d-none');
    }
  }

  function renderIncome() {
    setIncomeLoading(false);
    const table = els.incomeTableBody;
    if (!table) return;
    table.innerHTML = '';

    const payslips = [...state.payslips].sort((a, b) => {
      const aDate = new Date(a?.payDate || a?.period?.end || 0);
      const bDate = new Date(b?.payDate || b?.period?.end || 0);
      return bDate.getTime() - aDate.getTime();
    });

    els.incomeTotalCount.textContent = payslips.length ? `${payslips.length} payslips processed` : '';

    if (!payslips.length) {
      els.incomeEmpty?.classList.remove('d-none');
      return;
    }
    els.incomeEmpty?.classList.add('d-none');

    payslips.forEach((payslip) => {
      const deductions = summariseDeductions(payslip);
      const badge = resolveSourceBadge(payslip);
      const row = document.createElement('tr');
      row.dataset.payslipId = payslip.id;
      row.innerHTML = `
        <td>
          <div class="fw-semibold">${escapeHtml(payslip.employer || 'Employer')}</div>
          <div class="small text-secondary">${formatPeriod(payslip.period)}</div>
          ${badge ? `<span class="badge text-bg-secondary ms-1">${escapeHtml(badge)}</span>` : ''}
        </td>
        <td>${formatDate(payslip.payDate)}</td>
        <td class="text-end">${formatCurrency(payslip?.totals?.net)}</td>
        <td class="text-end">${formatCurrency(deductions.tax)}</td>
        <td class="text-end">${formatCurrency(deductions.ni)}</td>
        <td class="text-end">${formatCurrency(deductions.pension)}</td>
        <td class="text-end">${formatCurrency(deductions.studentLoan)}</td>
        <td class="text-end">${formatCurrency(deductions.other)}</td>
        <td class="text-end">
          <button type="button" class="btn btn-outline-secondary btn-sm" data-action="view-json">JSON</button>
        </td>`;
      row.addEventListener('click', (event) => {
        if (event.target.closest('[data-action="view-json"]')) return;
        openIncomeDetail(payslip);
      });
      row.querySelector('[data-action="view-json"]').addEventListener('click', (event) => {
        event.stopPropagation();
        openIncomeDetail(payslip);
      });
      table.appendChild(row);
    });

    renderIncomeSources();
    renderIncomeTrend();
  }

  function renderIncomeSources() {
    const sources = Array.isArray(state.overview?.metrics?.income?.bySource)
      ? state.overview.metrics.income.bySource
      : [];
    const list = els.incomeSourceList;
    if (list) {
      list.innerHTML = '';
      sources.slice(0, 5).forEach((entry) => {
        const item = document.createElement('li');
        const amount = formatCurrency(entry.total);
        item.innerHTML = `<div class="d-flex justify-content-between"><span>${escapeHtml(entry.name || 'Source')}</span><span class="fw-semibold">${amount}</span></div>`;
        list.appendChild(item);
      });
    }

    const data = {
      labels: sources.map((entry) => entry.name || 'Source'),
      datasets: [
        {
          label: 'Income share',
          data: sources.map((entry) => entry.total || 0),
          backgroundColor: buildPalette(sources.length),
        },
      ],
    };
    renderChart('income-source-chart', { type: 'doughnut', data, options: { responsive: true, maintainAspectRatio: false } });
  }

  function renderIncomeTrend() {
    const months = Array.isArray(state.overviewSeries?.months) ? state.overviewSeries.months : [];
    const incomeSeries = Array.isArray(state.overviewSeries?.income) ? state.overviewSeries.income : [];
    const values = months.map((month) => {
      const match = incomeSeries.find((entry) => entry.month === month);
      return match ? match.total || 0 : 0;
    });
    renderChart('income-trend-chart', {
      type: 'line',
      data: {
        labels: months.map(formatMonthLabel),
        datasets: [
          {
            label: 'Income',
            data: values,
            borderColor: 'rgba(25, 135, 84, 0.9)',
            backgroundColor: 'rgba(25, 135, 84, 0.2)',
            tension: 0.3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            ticks: { callback: (value) => formatCurrency(value) },
          },
        },
      },
    });
  }

  function openIncomeDetail(payslip) {
    if (!payslip) return;
    els.incomeDetailTitle.textContent = payslip.employer || 'Payslip';
    els.incomeDetailPeriod.textContent = buildPayslipSubheading(payslip);

    renderDetailMetrics(payslip);
    renderDetailList(els.incomeDetailEarnings, payslip.earnings);
    renderDetailList(els.incomeDetailDeductions, payslip.deductions, true);

    const maskedJson = maskSensitiveJson(payslip, state.privacyMode);
    els.incomeDetailJson.textContent = JSON.stringify(maskedJson, null, 2);

    if (offcanvasInstance) {
      offcanvasInstance.show();
    } else if (window.bootstrap?.Offcanvas) {
      const instance = window.bootstrap.Offcanvas.getOrCreateInstance(els.incomeDetailPanel);
      instance.show();
    }
  }

  function buildPayslipSubheading(payslip) {
    const parts = [];
    if (payslip.payDate) parts.push(formatDate(payslip.payDate));
    if (payslip.period?.label) parts.push(payslip.period.label);
    return parts.join(' · ');
  }

  function renderDetailMetrics(payslip) {
    const container = els.incomeDetailMetrics;
    if (!container) return;
    container.innerHTML = '';
    const metrics = [
      { label: 'Gross pay', value: payslip?.totals?.gross },
      { label: 'Net pay', value: payslip?.totals?.net },
      { label: 'Total deductions', value: payslip?.totals?.deductions },
    ];
    metrics.forEach((metric) => {
      const col = document.createElement('div');
      col.className = 'col-12 col-sm-4';
      col.innerHTML = `
        <div class="bg-body-tertiary border rounded p-3 h-100">
          <div class="text-secondary small">${escapeHtml(metric.label)}</div>
          <div class="fw-semibold">${formatCurrency(metric.value)}</div>
        </div>`;
      container.appendChild(col);
    });
  }

  function renderDetailList(container, entries, absolute = false) {
    if (!container) return;
    container.innerHTML = '';
    if (!Array.isArray(entries) || !entries.length) {
      const li = document.createElement('li');
      li.className = 'text-secondary';
      li.textContent = 'No data available';
      container.appendChild(li);
      return;
    }
    entries.forEach((entry) => {
      const li = document.createElement('li');
      li.innerHTML = `<div class="d-flex justify-content-between"><span>${escapeHtml(entry.label || entry.category || 'Item')}</span><span>${formatCurrency(absolute ? Math.abs(entry.amount) : entry.amount)}</span></div>`;
      container.appendChild(li);
    });
  }

  function summariseDeductions(payslip) {
    const totals = { tax: 0, ni: 0, pension: 0, studentLoan: 0, other: 0 };
    const deductions = Array.isArray(payslip?.deductions) ? payslip.deductions : [];
    deductions.forEach((item) => {
      const label = String(item?.label || item?.category || '').toLowerCase();
      const amount = Number(item?.amount ?? 0);
      if (!Number.isFinite(amount)) return;
      if (label.includes('tax')) totals.tax += Math.abs(amount);
      else if (label.includes('national insurance') || label === 'ni') totals.ni += Math.abs(amount);
      else if (label.includes('pension')) totals.pension += Math.abs(amount);
      else if (label.includes('student')) totals.studentLoan += Math.abs(amount);
      else totals.other += Math.abs(amount);
    });
    const totalDeductions = Number(payslip?.totals?.deductions ?? 0);
    if (!Number.isNaN(totalDeductions)) {
      const known = totals.tax + totals.ni + totals.pension + totals.studentLoan;
      const remainder = Math.max(0, totalDeductions - known);
      totals.other = Math.max(totals.other, remainder);
    }
    return totals;
  }

  function resolveSourceBadge(payslip) {
    const source = String(payslip?.extractionSource || payslip?.source || payslip?.metadata?.source || '').toLowerCase();
    if (!source) return null;
    if (source.includes('computed')) return 'Computed';
    if (source.includes('heuristic')) return 'Heuristic';
    if (source.includes('openai')) return 'Extracted';
    return source;
  }

  function setSpendingLoading(isLoading) {
    if (isLoading) {
      els.spendingLoading?.classList.remove('d-none');
      els.spendingContent?.classList.add('d-none');
    } else {
      els.spendingLoading?.classList.add('d-none');
      els.spendingContent?.classList.remove('d-none');
    }
  }

  function renderSpending() {
    setSpendingLoading(false);
    renderSpendingCategories();
    renderSpendingMerchants();
    renderSpendingTrend();
  }

  function renderSpendingCategories() {
    const container = els.spendingCategoryTiles;
    if (!container) return;
    container.innerHTML = '';
    const categories = Array.isArray(state.overview?.metrics?.spend?.byCategory)
      ? state.overview.metrics.spend.byCategory
      : [];
    categories.slice(0, 6).forEach((entry) => {
      const col = document.createElement('div');
      col.className = 'col-12 col-md-4 col-xl-2';
      const share = entry?.share != null ? `${(entry.share * 100).toFixed(1)}%` : '';
      col.innerHTML = `
        <div class="suite-card card shadow-sm h-100">
          <div class="card-body">
            <div class="text-secondary small text-uppercase">${escapeHtml(entry.name || entry.category || 'Category')}</div>
            <div class="h5 mb-0">${formatCurrency(entry.total)}</div>
            ${share ? `<div class="small text-secondary">${share} of spend</div>` : ''}
          </div>
        </div>`;
      container.appendChild(col);
    });
  }

  function renderSpendingMerchants() {
    const body = els.spendingMerchantBody;
    const empty = els.spendingMerchantEmpty;
    if (!body) return;
    body.innerHTML = '';
    const transactions = aggregateTransactions(state.statements);
    if (!transactions.length) {
      empty?.classList.remove('d-none');
      return;
    }
    empty?.classList.add('d-none');
    transactions.slice(0, 20).forEach((tx) => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${escapeHtml(tx.description)}</td>
        <td class="text-end">${formatCurrency(tx.amount)}</td>
        <td>${escapeHtml(tx.category || 'Other')}</td>
        <td class="text-end">${formatDate(tx.date)}</td>`;
      body.appendChild(row);
    });
  }

  function renderSpendingTrend() {
    const months = Array.isArray(state.overviewSeries?.months) ? state.overviewSeries.months : [];
    const spendSeries = Array.isArray(state.overviewSeries?.spend) ? state.overviewSeries.spend : [];
    const values = months.map((month) => {
      const entry = spendSeries.find((item) => item.month === month);
      return entry ? entry.total || 0 : 0;
    });
    renderChart('spending-trend-chart', {
      type: 'bar',
      data: {
        labels: months.map(formatMonthLabel),
        datasets: [
          {
            label: 'Spend',
            data: values,
            backgroundColor: 'rgba(220, 53, 69, 0.7)',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { ticks: { callback: (value) => formatCurrency(value) } },
        },
      },
    });

    renderSpendingAnomalies(months, values);
  }

  function renderSpendingAnomalies(months, values) {
    const list = els.spendingAnomalies;
    if (!list) return;
    list.innerHTML = '';
    const anomalies = [];
    for (let i = 0; i < values.length; i += 1) {
      if (i < 3) continue;
      const windowValues = values.slice(i - 3, i);
      const avg = windowValues.reduce((sum, value) => sum + value, 0) / windowValues.length;
      if (avg <= 0) continue;
      if (values[i] > avg * 2) {
        anomalies.push({ month: months[i], amount: values[i], avg });
      }
    }
    anomalies.forEach((item) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="badge text-bg-warning text-dark me-2"><i class="bi bi-exclamation-triangle-fill me-1"></i>Anomaly</span>${formatMonthLabel(item.month)} spend ${formatCurrency(item.amount)} vs ${formatCurrency(item.avg)} avg.`;
      list.appendChild(li);
    });
  }

  function setTaxLoading(isLoading) {
    if (isLoading) {
      els.taxLoading?.classList.remove('d-none');
      els.taxContent?.classList.add('d-none');
    } else {
      els.taxLoading?.classList.add('d-none');
      els.taxContent?.classList.remove('d-none');
    }
  }

  function renderTax() {
    setTaxLoading(false);
    renderTaxYtd();
    renderTaxChecklist();
  }

  function renderTaxYtd() {
    const list = els.taxYtdList;
    if (!list) return;
    list.innerHTML = '';
    const latest = [...state.payslips]
      .sort((a, b) => new Date(b?.payDate || 0) - new Date(a?.payDate || 0))[0];
    const ytd = computeTaxYtd(latest);
    const entries = [
      { label: 'PAYE year-to-date', value: ytd.tax },
      { label: 'National Insurance YTD', value: ytd.ni },
      { label: 'Student loan YTD', value: ytd.studentLoan },
      { label: 'Pension contributions YTD', value: ytd.pension },
    ];
    entries.forEach((entry) => {
      const dt = document.createElement('dt');
      dt.className = 'col-7 col-md-6 text-secondary';
      dt.textContent = entry.label;
      const dd = document.createElement('dd');
      dd.className = 'col-5 col-md-6 text-end fw-semibold';
      dd.textContent = formatCurrency(entry.value);
      list.append(dt, dd);
    });
  }

  function computeTaxYtd(payslip) {
    const result = { tax: 0, ni: 0, studentLoan: 0, pension: 0 };
    if (!payslip) return result;
    const deductions = Array.isArray(payslip.deductions) ? payslip.deductions : [];
    deductions.forEach((item) => {
      const label = String(item?.label || item?.category || '').toLowerCase();
      const amountYtd = Number(item?.amountYtd ?? item?.amount ?? 0);
      if (!Number.isFinite(amountYtd)) return;
      if (label.includes('tax')) result.tax = Math.max(result.tax, Math.abs(amountYtd));
      if (label.includes('national insurance') || label === 'ni') result.ni = Math.max(result.ni, Math.abs(amountYtd));
      if (label.includes('student')) result.studentLoan = Math.max(result.studentLoan, Math.abs(amountYtd));
      if (label.includes('pension')) result.pension = Math.max(result.pension, Math.abs(amountYtd));
    });
    return result;
  }

  function renderTaxChecklist() {
    const list = els.taxChecklist;
    if (!list) return;
    list.innerHTML = '';
    const docTypes = collectDocumentTypes();
    const checklistItems = [
      { label: 'Payslips uploaded', value: state.payslips.length, done: state.payslips.length > 0 },
      { label: 'Bank statements uploaded', value: state.statements.length, done: state.statements.length > 0 },
      ...requiredDocs.map((doc) => ({
        label: doc.label,
        value: docTypes.has(doc.key) ? 'On file' : 'Missing',
        done: docTypes.has(doc.key),
      })),
    ];
    checklistItems.forEach((item) => {
      const li = document.createElement('li');
      li.className = 'd-flex justify-content-between align-items-center mb-2';
      li.innerHTML = `
        <div>
          <span class="${item.done ? 'text-success' : 'text-secondary'}">
            <i class="bi ${item.done ? 'bi-check-circle-fill' : 'bi-dot'} me-2"></i>${escapeHtml(item.label)}
          </span>
        </div>
        <span class="fw-semibold">${typeof item.value === 'number' ? item.value : escapeHtml(String(item.value))}</span>`;
      list.appendChild(li);
    });
  }

  function collectDocumentTypes() {
    const set = new Set();
    state.documents.forEach((doc) => {
      const key = String(
        doc?.docupipe?.catalogueKey
        || doc?.docupipe?.classification?.key
        || doc?.docupipe?.documentType
        || ''
      ).toLowerCase();
      if (key) set.add(key);
      if (key === 'current_account_statement') set.add('bank_statement');
    });
    return set;
  }

  function setWealthLoading(isLoading) {
    if (isLoading) {
      els.wealthLoading?.classList.remove('d-none');
      els.wealthContent?.classList.add('d-none');
    } else {
      els.wealthLoading?.classList.add('d-none');
      els.wealthContent?.classList.remove('d-none');
    }
  }

  function renderWealth() {
    const balancesSeries = buildBalanceSeries(state.statements);
    const hasBalances = balancesSeries.length > 0;
    setWealthLoading(false);
    if (!hasBalances) {
      els.wealthEmpty?.classList.remove('d-none');
      renderChart('wealth-balance-chart', null);
      els.wealthSavingsRate.textContent = '—';
      els.wealthRunway.textContent = '—';
      els.wealthRunwayCaption.textContent = '';
      els.wealthBalances.innerHTML = '';
      return;
    }
    els.wealthEmpty?.classList.add('d-none');

    renderChart('wealth-balance-chart', {
      type: 'line',
      data: {
        labels: balancesSeries.map((entry) => formatMonthLabel(entry.month)),
        datasets: [
          {
            label: 'Closing balance',
            data: balancesSeries.map((entry) => entry.total),
            borderColor: 'rgba(102, 16, 242, 0.9)',
            backgroundColor: 'rgba(102, 16, 242, 0.15)',
            tension: 0.3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { ticks: { callback: (value) => formatCurrency(value) } },
        },
      },
    });

    const savingsRate = state.overview?.metrics?.savingsRatePct ?? null;
    els.wealthSavingsRate.textContent = savingsRate != null ? `${Number(savingsRate).toFixed(1)}%` : '—';

    const runway = computeRunway(balancesSeries, state.overviewSeries?.spend || []);
    els.wealthRunway.textContent = runway?.label || '—';
    els.wealthRunwayCaption.textContent = runway?.caption || '';

    renderAccountBalances(state.statements);
  }

  function buildBalanceSeries(statements) {
    const map = new Map();
    statements.forEach((statement) => {
      const month = resolveStatementMonth(statement);
      const closing = Number(statement?.closingBalance ?? statement?.balances?.closing ?? statement?.totals?.closingBalance ?? 0);
      if (!month || !Number.isFinite(closing)) return;
      const current = map.get(month) || { month, total: 0 };
      current.total += closing;
      map.set(month, current);
    });
    return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
  }

  function resolveStatementMonth(statement) {
    const month = statement?.period?.month || statement?.documentMonth;
    if (month) return month.slice(0, 7);
    if (statement?.period?.end) return String(statement.period.end).slice(0, 7);
    if (statement?.period?.start) return String(statement.period.start).slice(0, 7);
    return null;
  }

  function computeRunway(balanceSeries, spendSeries) {
    if (!balanceSeries.length) return null;
    const latest = balanceSeries[balanceSeries.length - 1];
    const spends = Array.isArray(spendSeries) ? spendSeries.map((entry) => entry.total || 0).filter((value) => value > 0) : [];
    if (!spends.length) return null;
    const avgSpend = spends.reduce((sum, value) => sum + value, 0) / spends.length;
    if (avgSpend <= 0) return null;
    const months = latest.total / avgSpend;
    if (!Number.isFinite(months)) return null;
    const label = `${months.toFixed(1)} months`;
    const caption = `Based on average spend of ${formatCurrency(avgSpend)} per month.`;
    return { label, caption };
  }

  function renderAccountBalances(statements) {
    const list = els.wealthBalances;
    if (!list) return;
    list.innerHTML = '';
    const accountMap = new Map();
    statements.forEach((statement) => {
      const name = statement?.accountName || 'Account';
      const closing = Number(statement?.closingBalance ?? statement?.balances?.closing ?? 0);
      if (!Number.isFinite(closing)) return;
      const entry = accountMap.get(name) || { total: 0, name, accountNumber: statement?.accountNumberMasked };
      entry.total += closing;
      if (!entry.accountNumber && statement?.accountNumberMasked) {
        entry.accountNumber = statement.accountNumberMasked;
      }
      accountMap.set(name, entry);
    });
    Array.from(accountMap.values())
      .sort((a, b) => b.total - a.total)
      .forEach((account) => {
        const li = document.createElement('li');
        const masked = state.privacyMode && account.accountNumber
          ? maskIdentifier(account.accountNumber)
          : account.accountNumber || '';
        li.innerHTML = `<div class="d-flex justify-content-between"><span>${escapeHtml(account.name)}${masked ? `<span class="text-secondary ms-2">${escapeHtml(masked)}</span>` : ''}</span><span class="fw-semibold">${formatCurrency(account.total)}</span></div>`;
        list.appendChild(li);
      });
  }

  function handleFiles(fileList) {
    if (!fileList?.length) return;
    const files = Array.from(fileList).filter((file) => {
      const type = (file.type || '').toLowerCase();
      const name = (file.name || '').toLowerCase();
      const isPdf = type.includes('pdf') || name.endsWith('.pdf');
      const isZip = type.includes('zip') || name.endsWith('.zip');
      if (!isPdf && !isZip) {
        showToast(`${file.name} is not a supported file type`, 'warning');
        return false;
      }
      return true;
    });
    files.forEach((file) => uploadFile(file));
  }

  async function uploadFile(file) {
    const key = `${file.name}:${file.size}`;
    if (state.uploading.has(key)) {
      showToast(`${file.name} is already uploading`, 'info');
      return;
    }
    const entry = createUploadEntry(file);
    state.uploading.set(key, entry);
    try {
      entry.setStatus('Requesting upload…');
      const { uploadUrl } = await presignUpload(file);
      entry.setStatus('Uploading…', 'primary');
      await uploadWithProgress(uploadUrl, file, (progress) => entry.setProgress(progress));
      entry.setStatus('Finalising…', 'primary');
      entry.done();
      showToast(`Uploaded ${file.name}`, 'success');
      await fetchDocuments({ reset: true });
    } catch (error) {
      console.error('Upload failed', error);
      entry.markError(error.message || 'Upload failed');
      showToast(`Upload failed for ${file.name}`, 'danger');
    } finally {
      state.uploading.delete(key);
    }
  }

  function createUploadEntry(file) {
    const container = els.uploadQueue;
    if (!container) {
      return {
        setStatus() {},
        setProgress() {},
        markError() {},
        done() {},
      };
    }
    container.removeAttribute('hidden');
    const wrapper = document.createElement('div');
    wrapper.className = 'suite-upload-item';
    wrapper.innerHTML = `
      <div class="d-flex justify-content-between align-items-start">
        <div>
          <div class="fw-semibold text-truncate" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
          <small class="text-secondary">${formatBytes(file.size)}</small>
        </div>
        <span class="upload-status text-secondary">Pending…</span>
      </div>
      <div class="progress mt-3" role="progressbar" aria-valuemin="0" aria-valuemax="100">
        <div class="progress-bar" style="width:0%"></div>
      </div>`;
    container.appendChild(wrapper);
    return {
      setStatus(text, variant = 'secondary') {
        const status = wrapper.querySelector('.upload-status');
        if (status) {
          status.textContent = text;
          status.className = `upload-status text-${variant}`;
        }
      },
      setProgress(value) {
        const progressBar = wrapper.querySelector('.progress-bar');
        if (progressBar) {
          progressBar.style.width = `${Math.max(0, Math.min(100, value))}%`;
        }
      },
      markError(message) {
        wrapper.classList.add('is-error');
        this.setStatus(message || 'Upload failed', 'danger');
      },
      done() {
        this.setStatus('Uploaded', 'success');
        setTimeout(() => {
          wrapper.remove();
          if (!container.children.length) container.setAttribute('hidden', 'hidden');
        }, 1500);
      },
    };
  }

  async function presignUpload(file) {
    const res = await Auth.fetch('/api/vault/presign-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        fileSize: file.size,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || 'Failed to request upload');
    }
    return res.json();
  }

  function uploadWithProgress(url, file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url);
      xhr.responseType = 'text';
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const value = Math.round((event.loaded / event.total) * 100);
          onProgress?.(value);
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress?.(100);
          resolve();
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.send(file);
    });
  }

  async function handleDownload(doc) {
    try {
      const { downloadUrl } = await presignDownload(doc.id);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = doc.filename;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      console.error('Download failed', error);
      showToast('Download failed. Please retry.', 'danger');
    }
  }

  async function handlePreview(doc) {
    try {
      const { downloadUrl } = await presignDownload(doc.id);
      const modalElement = els.previewModal;
      if (!modalElement) {
        window.open(downloadUrl, '_blank', 'noopener');
        return;
      }
      if (els.previewTitle) {
        els.previewTitle.textContent = doc.filename;
      }
      if (els.previewBody) {
        if (doc.fileType && !doc.fileType.toLowerCase().includes('pdf')) {
          els.previewBody.innerHTML = `<div class="alert alert-info mb-0">Preview is available for PDFs. Download to view the original file.</div>`;
        } else {
          els.previewBody.innerHTML = `<iframe src="${downloadUrl}#view=FitH" title="${escapeHtml(doc.filename)}" class="suite-preview-frame" allow="fullscreen"></iframe>`;
        }
      }
      const modal = window.bootstrap?.Modal.getOrCreateInstance(modalElement);
      modal?.show();
    } catch (error) {
      console.error('Preview failed', error);
      showToast('Unable to open preview.', 'danger');
    }
  }

  async function handleDelete(doc) {
    if (!window.confirm(`Delete ${doc.filename}? This action cannot be undone.`)) return;
    try {
      const res = await Auth.fetch(`/api/vault/${encodeURIComponent(doc.id)}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Delete failed');
      }
      showToast(`${doc.filename} deleted`, 'success');
      state.documents = state.documents.filter((item) => item.id !== doc.id);
      renderDocuments();
      renderRibbon();
      updateOverviewStatus();
    } catch (error) {
      console.error('Delete failed', error);
      showToast('Unable to delete document.', 'danger');
    }
  }

  async function presignDownload(docId) {
    const res = await Auth.fetch(`/api/vault/presign-download/${encodeURIComponent(docId)}`, { cache: 'no-store' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || 'Unable to generate download link');
    }
    return res.json();
  }

  function startJobStream() {
    if (state.jobStream) {
      state.jobStream.abort();
      state.jobStream = null;
    }
    const token = typeof Auth.getToken === 'function' ? Auth.getToken() : null;
    if (!token) return;
    const controller = new AbortController();
    state.jobStream = controller;
    fetch('/api/jobs/stream', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok || !response.body) throw new Error(`Stream ${response.status}`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary;
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const chunk = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            if (!chunk.trim() || chunk.startsWith(':')) continue;
            const dataLine = chunk.split('\n').find((line) => line.startsWith('data:'));
            if (!dataLine) continue;
            const payload = dataLine.slice(5).trim();
            if (!payload) continue;
            try {
              const event = JSON.parse(payload);
              handleJobEvent(event);
            } catch (error) {
              console.warn('Failed to parse job event', error);
            }
          }
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.warn('Job stream disconnected', error);
        scheduleJobReconnect();
      });
  }

  function scheduleJobReconnect() {
    if (state.jobReconnectTimer) return;
    state.jobReconnectTimer = setTimeout(() => {
      state.jobReconnectTimer = null;
      startJobStream();
    }, 5000);
  }

  function handleJobEvent(event) {
    if (!event) return;
    if (event.type === 'snapshot' && Array.isArray(event.jobs)) {
      mergeJobSnapshot(event.jobs);
    } else if (event.type === 'update' && event.job) {
      mergeJobUpdate(event.job);
    }
  }

  function mergeJobSnapshot(jobs) {
    const jobMap = new Map(jobs.map((job) => [job.documentId, job]));
    state.documents = state.documents.map((doc) => {
      const job = jobMap.get(doc.id);
      return job ? { ...doc, job } : doc;
    });
    renderDocuments();
    renderRibbon();
    updateOverviewStatus();
  }

  function mergeJobUpdate(job) {
    let changed = false;
    state.documents = state.documents.map((doc) => {
      if (doc.id !== job.documentId) return doc;
      changed = true;
      const prevStatus = state.documentStatusMap.get(doc.id);
      const nextStatus = job.status || doc.status;
      if (prevStatus && nextStatus && prevStatus !== nextStatus) {
        notifyStatusChange(doc, nextStatus);
        state.documentStatusMap.set(doc.id, nextStatus);
      }
      return { ...doc, job: { ...job } };
    });
    if (changed) {
      renderDocuments();
      renderRibbon();
      updateOverviewStatus();
    }
  }

  function notifyStatusChange(doc, status) {
    if (status === 'completed' || status === 'ready') {
      showToast(`${doc.filename} is ready`, 'success');
    } else if (status === 'failed') {
      showToast(`${doc.filename} failed to process`, 'danger');
    }
  }

  function hydrateUserMeta(me) {
    const host = els.userMeta;
    if (!host || !me) return;
    const nameParts = [me.firstName, me.lastName].filter(Boolean);
    const displayName = nameParts.join(' ').trim() || me.companyName || (me.email || '').split('@')[0] || 'Account';
    const initials = (displayName.match(/\p{L}/gu) || []).slice(0, 2).join('').toUpperCase() || 'U';
    host.innerHTML = `
      <div class="topbar-user-chip" role="presentation">
        <div class="topbar-avatar" aria-hidden="true">${escapeHtml(initials)}</div>
        <div class="topbar-user-details">
          <span class="topbar-user-name">${escapeHtml(displayName)}</span>
          <span class="topbar-user-plan">${escapeHtml((me.licenseTier || 'Free').replace(/\b\w/g, (c) => c.toUpperCase()))}</span>
        </div>
      </div>`;
  }

  function handleScrollActiveNav() {
    const sections = els.sections();
    const scrollPos = window.scrollY + 120;
    let activeId = null;
    sections.forEach((section) => {
      if (!(section instanceof HTMLElement)) return;
      const top = section.offsetTop;
      if (scrollPos >= top) {
        activeId = section.id;
      }
    });
    els.navItems().forEach((button) => {
      if (button.getAttribute('data-nav-target') === activeId) {
        button.classList.add('active');
      } else {
        button.classList.remove('active');
      }
    });
  }

  function renderChart(id, config) {
    if (typeof window.Chart === 'undefined') {
      console.warn('Chart.js unavailable');
      return;
    }
    const existing = state.charts[id];
    if (existing && typeof existing.destroy === 'function') {
      existing.destroy();
      delete state.charts[id];
    }
    if (!config) return;
    const canvas = document.getElementById(id);
    if (!canvas) return;
    state.charts[id] = new window.Chart(canvas, config);
  }

  function buildPalette(count) {
    const base = ['#0d6efd', '#20c997', '#6610f2', '#ffc107', '#dc3545', '#fd7e14'];
    if (count <= base.length) return base.slice(0, count);
    const palette = [];
    for (let i = 0; i < count; i += 1) {
      const hue = Math.round((360 / count) * i);
      palette.push(`hsl(${hue}deg 70% 55%)`);
    }
    return palette;
  }

  function aggregateTransactions(statements) {
    const map = new Map();
    statements.forEach((statement) => {
      const transactions = Array.isArray(statement?.transactions) ? statement.transactions : [];
      transactions.forEach((tx) => {
        if (!tx || typeof tx !== 'object') return;
        const amount = Number(tx.amount || 0);
        if (!Number.isFinite(amount) || amount >= 0) return;
        const key = tx.description || tx.label || 'Merchant';
        const entry = map.get(key) || { description: key, amount: 0, category: tx.category || 'Other', date: tx.date || null };
        entry.amount += Math.abs(amount);
        if (!entry.date || (tx.date && new Date(tx.date) > new Date(entry.date))) {
          entry.date = tx.date;
        }
        entry.category = tx.category || entry.category;
        map.set(key, entry);
      });
    });
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
  }

  function maskSensitiveJson(value, privacyMode) {
    if (!privacyMode) return value;
    if (Array.isArray(value)) {
      return value.map((item) => maskSensitiveJson(item, privacyMode));
    }
    if (value && typeof value === 'object') {
      const result = {};
      Object.entries(value).forEach(([key, val]) => {
        if (/account|iban|sort|ni|utr|tax/i.test(key)) {
          result[key] = maskIdentifier(val);
        } else {
          result[key] = maskSensitiveJson(val, privacyMode);
        }
      });
      return result;
    }
    if (typeof value === 'string' && /\d{3,}/.test(value)) {
      return maskIdentifier(value);
    }
    return value;
  }

  function maskIdentifier(value) {
    const str = String(value || '');
    if (!str) return '••••';
    if (str.length <= 4) return '•'.repeat(str.length);
    return `${'•'.repeat(Math.max(0, str.length - 4))}${str.slice(-4)}`;
  }

  function detectPrivacyMode() {
    const flag = document.documentElement?.dataset?.privacyMode;
    if (flag && flag.toLowerCase() === 'true') return true;
    try {
      const stored = localStorage.getItem('ai-accountant:privacy-mode') || sessionStorage.getItem('ai-accountant:privacy-mode');
      if (stored && stored.toLowerCase() === 'true') return true;
    } catch (error) {
      console.warn('Privacy mode detection failed', error);
    }
    return false;
  }

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value <= 0) return '—';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
    const formatted = value / (1024 ** index);
    return `${formatted >= 10 ? formatted.toFixed(0) : formatted.toFixed(1)} ${units[index]}`;
  }

  function formatDate(date) {
    if (!date) return '—';
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { dateStyle: 'medium' });
  }

  function formatDateTime(date) {
    if (!date) return '—';
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function formatValue(value, format) {
    if (value == null) return '—';
    switch (format) {
      case 'currency':
        return formatCurrency(value);
      case 'percent':
        return `${Number(value).toFixed(1)}%`;
      default:
        return String(value);
    }
  }

  function formatCurrency(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return number.toLocaleString(undefined, { style: 'currency', currency: 'GBP' });
  }

  function formatMonthLabel(month) {
    if (!month) return '';
    const match = month.match(/^(\d{4})-(\d{2})$/);
    if (match) {
      const date = new Date(`${match[1]}-${match[2]}-01T00:00:00Z`);
      if (!Number.isNaN(date.getTime())) {
        return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
      }
    }
    return month;
  }

  function formatPeriod(period) {
    if (!period) return '';
    const label = period.label || '';
    const start = period.start ? formatDate(period.start) : '';
    const end = period.end ? formatDate(period.end) : '';
    if (label) return label;
    if (start && end) return `${start} → ${end}`;
    return start || end || '';
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showToast(message, variant = 'info') {
    const container = els.toasts;
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast align-items-center text-bg-${variant}`;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.innerHTML = `
      <div class="d-flex">
        <div class="toast-body">${escapeHtml(message)}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
      </div>`;
    container.appendChild(toast);
    const Toast = window.bootstrap?.Toast;
    if (typeof Toast === 'function') {
      const instance = new Toast(toast, { delay: 4000 });
      instance.show();
      toast.addEventListener('hidden.bs.toast', () => toast.remove());
    } else {
      toast.classList.add('show');
      setTimeout(() => toast.remove(), 4000);
    }
  }

  function showGlobalError(message) {
    if (!els.globalError) return;
    els.globalErrorMessage.textContent = message;
    els.globalError.classList.remove('d-none');
  }

  function hideGlobalError() {
    if (!els.globalError) return;
    els.globalError.classList.add('d-none');
  }
})();
