// frontend/js/vault.js
(function () {
  const API_BASE = '/api/vault';
  const POLL_INTERVAL_UPLOAD = 3000;
  const POLL_INTERVAL_TILES = 10000;
  const POLL_INTERVAL_LISTS = 15000;
  const PROCESS_POLL_INTERVAL = 3000;
  const STATUS_LABELS = {
    idle: 'Ready',
    queued: 'Queued',
    processing: 'Processing…',
    completed: 'Completed',
    failed: 'Failed',
    needs_trim: 'Manual trim required',
    awaiting_manual_json: 'Manual JSON required',
  };
  const STATUS_ICONS = {
    idle: 'bi-pause-circle',
    queued: 'bi-clock-history',
    completed: 'bi-check-circle',
    failed: 'bi-x-octagon',
    needs_trim: 'bi-exclamation-triangle',
    awaiting_manual_json: 'bi-pencil-square',
  };
  const LEGACY_STATUS_MAP = {
    red: 'queued',
    amber: 'processing',
    yellow: 'processing',
    orange: 'processing',
    green: 'completed',
    complete: 'completed',
    completed: 'completed',
    success: 'completed',
    error: 'failed',
    failed: 'failed',
    waiting: 'queued',
    pending: 'queued',
    ready: 'idle',
  };
  const TRIM_AUTOTRIM_MESSAGE = 'Document trimmed automatically. Review before processing.';
  const STORAGE_KEY = 'vault.uploadSessions.v1';

  const BRAND_THEMES = [
    { className: 'grid-card--brand-monzo', tokens: ['monzo'] },
    { className: 'grid-card--brand-halifax', tokens: ['halifax'] },
    { className: 'grid-card--brand-lloyds', tokens: ['lloyds', 'lloyd'] },
    { className: 'grid-card--brand-hsbc', tokens: ['hsbc'] },
    { className: 'grid-card--brand-natwest', tokens: ['natwest', 'nat west', 'royal bank of scotland'] },
    { className: 'grid-card--brand-santander', tokens: ['santander'] },
    { className: 'grid-card--brand-barclays', tokens: ['barclays', 'barclaycard'] },
    { className: 'grid-card--brand-starling', tokens: ['starling'] },
    { className: 'grid-card--brand-revolut', tokens: ['revolut'] },
    { className: 'grid-card--brand-nationwide', tokens: ['nationwide'] },
    { className: 'grid-card--brand-firstdirect', tokens: ['first direct'] },
    { className: 'grid-card--brand-tsb', tokens: ['tsb'] },
    { className: 'grid-card--brand-vanguard', tokens: ['vanguard'] },
    { className: 'grid-card--brand-fidelity', tokens: ['fidelity'] },
    { className: 'grid-card--brand-hl', tokens: ['hargreaves', 'lansdown'] },
    { className: 'grid-card--brand-aviva', tokens: ['aviva'] },
    { className: 'grid-card--brand-scottishwidows', tokens: ['scottish widows'] },
    { className: 'grid-card--brand-hmrc', tokens: ['hmrc', 'hm revenue', "her majesty's revenue"] },
    { className: 'grid-card--brand-amazon', tokens: ['amazon'] },
    { className: 'grid-card--brand-google', tokens: ['google', 'alphabet'] },
    { className: 'grid-card--brand-microsoft', tokens: ['microsoft'] },
    { className: 'grid-card--brand-apple', tokens: ['apple'] },
    { className: 'grid-card--brand-meta', tokens: ['meta', 'facebook'] },
    { className: 'grid-card--brand-tesco', tokens: ['tesco'] },
    { className: 'grid-card--brand-sainsbury', tokens: ["sainsbury", "sainsbury's"] },
    { className: 'grid-card--brand-shell', tokens: ['shell'] },
    { className: 'grid-card--brand-bp', tokens: ['^bp$', 'bp plc', 'british petroleum'] },
  ];

  function normaliseBrandName(name) {
    return String(name || '').toLowerCase();
  }

  function findBrandTheme(name) {
    if (!name) return null;
    const target = normaliseBrandName(name);
    return BRAND_THEMES.find((theme) =>
      theme.tokens.some((tokenRaw) => {
        const token = normaliseBrandName(tokenRaw);
        if (!token) return false;
        if (token.startsWith('^') && token.endsWith('$')) {
          return target === token.slice(1, -1);
        }
        return target.includes(token);
      })
    );
  }

  function hashNameToHue(name) {
    const input = normaliseBrandName(name);
    let hash = 0;
    for (let i = 0; i < input.length; i += 1) {
      hash = (hash << 5) - hash + input.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash) % 360;
  }

  function applyEntityBranding(card, name) {
    if (!card) return;
    card.className = 'grid-card';
    card.style.removeProperty('--card-brand-hue');
    const theme = findBrandTheme(name);
    if (theme) {
      card.classList.add('grid-card--brand', theme.className);
      return;
    }
    if (name) {
      card.classList.add('grid-card--brand', 'grid-card--brand-generic');
      card.style.setProperty('--card-brand-hue', `${hashNameToHue(name)}`);
    }
  }

  const state = {
    sessions: new Map(),
    files: new Map(),
    timers: { uploads: null, tiles: null, lists: null },
    placeholders: new Map(),
    collections: [],
    selectedCollectionId: null,
    viewer: { type: null, context: null, files: [], selectedFileId: null },
  };

  const processingPollers = new Map();

  let unauthorised = false;
  let viewerPreviewUrl = null;
  let viewerPreviewToken = 0;
  let jsonTestEnabled = false;
  let jsonModal = null;
  let jsonModalTitle = null;
  let jsonModalMeta = null;
  let jsonModalContent = null;
  let jsonModalClose = null;
  let jsonModalReturnFocus = null;
  let jsonModalStylesInjected = false;

  let trimModal = null;
  let trimModalDialog = null;
  let trimModalTitle = null;
  let trimModalMeta = null;
  let trimModalList = null;
  let trimModalLoading = null;
  let trimModalError = null;
  let trimModalForm = null;
  let trimModalApply = null;
  let trimModalCancel = null;
  let trimModalClose = null;
  let trimModalReturnFocus = null;
  let trimModalStylesInjected = false;

  const trimReviewState = {
    docId: null,
    file: null,
    pageCount: 0,
    keptPages: new Set(),
    isLoading: false,
    isSubmitting: false,
  };

  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  const sessionRows = document.getElementById('session-rows');
  const sessionEmpty = document.getElementById('session-empty');
  const tilesGrid = document.getElementById('tiles-grid');
  const payslipGrid = document.getElementById('payslip-grid');
  const statementGrid = document.getElementById('statement-grid');
  const collectionGrid = document.getElementById('collection-grid');
  const payslipMeta = document.getElementById('payslip-meta');
  const statementMeta = document.getElementById('statement-meta');
  const collectionMeta = document.getElementById('collection-meta');
  const progressContainer = document.getElementById('vault-progress');
  const progressPhase = document.getElementById('vault-progress-phase');
  const progressCount = document.getElementById('vault-progress-count');
  const progressBar = document.getElementById('vault-progress-bar');
  const collectionTarget = document.getElementById('collection-target');
  const viewerRoot = document.getElementById('file-viewer');
  const viewerOverlay = document.getElementById('file-viewer-overlay');
  const viewerList = document.getElementById('file-viewer-list');
  const viewerFrame = document.getElementById('file-viewer-frame');
  const viewerEmpty = document.getElementById('file-viewer-empty');
  const viewerTitle = document.getElementById('file-viewer-title');
  const viewerSubtitle = document.getElementById('file-viewer-subtitle');
  const viewerClose = document.getElementById('file-viewer-close');

  function formatDate(value) {
    if (!value) return '—';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString();
  }

  function toNumberLike(value) {
    if (value == null) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const cleaned = value.replace(/[^0-9.-]+/g, '');
      if (!cleaned) return null;
      const parsed = Number(cleaned);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  }

  function formatMoney(value, currency) {
    if (value == null || value === '') return '—';
    const number = toNumberLike(value);
    if (number == null) {
      return typeof value === 'string' && value.trim() ? value : '—';
    }
    const code = typeof currency === 'string' && currency.trim().length === 3 ? currency.trim().toUpperCase() : 'GBP';
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(number);
    } catch (error) {
      console.warn('formatMoney fallback', error);
      return number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
  }

  function formatNumber(value) {
    const number = toNumberLike(value);
    if (number == null) return value == null ? '—' : String(value);
    return number.toLocaleString();
  }

  function normalisePageCount(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return null;
    return Math.max(1, Math.round(number));
  }

  function pickFirstNumber(values) {
    if (!Array.isArray(values)) return null;
    for (const value of values) {
      const number = normalisePageCount(value);
      if (number != null) return number;
    }
    return null;
  }

  function normalisePageNumbers(value) {
    const pages = [];

    const addPage = (page) => {
      const number = Number(page);
      if (!Number.isFinite(number)) return;
      const rounded = Math.round(number);
      if (rounded >= 1) {
        pages.push(rounded);
      }
    };

    const addRange = (start, end) => {
      const startNumber = Number(start);
      const endNumber = Number(end);
      if (!Number.isFinite(startNumber) || !Number.isFinite(endNumber)) return;
      const startRounded = Math.round(startNumber);
      const endRounded = Math.round(endNumber);
      if (startRounded === endRounded) {
        addPage(startRounded);
        return;
      }
      const step = startRounded < endRounded ? 1 : -1;
      for (let current = startRounded; step > 0 ? current <= endRounded : current >= endRounded; current += step) {
        addPage(current);
      }
    };

    const parseToken = (token) => {
      const trimmed = String(token || '').trim();
      if (!trimmed) return;
      const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
      if (rangeMatch) {
        addRange(Number(rangeMatch[1]), Number(rangeMatch[2]));
        return;
      }
      addPage(trimmed);
    };

    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (Array.isArray(entry)) {
          entry.forEach(parseToken);
          return;
        }
        if (entry && typeof entry === 'object') {
          if ('start' in entry && 'end' in entry) {
            addRange(entry.start, entry.end);
            return;
          }
          if ('page' in entry) {
            addPage(entry.page);
            return;
          }
        }
        parseToken(entry);
      });
    } else if (value && typeof value === 'object') {
      if ('start' in value && 'end' in value) {
        addRange(value.start, value.end);
      } else if ('page' in value) {
        addPage(value.page);
      } else if (Symbol.iterator in value) {
        Array.from(value).forEach(parseToken);
      }
    } else if (typeof value === 'string') {
      value.split(/[\s,]+/).forEach(parseToken);
    } else {
      parseToken(value);
    }

    const unique = Array.from(new Set(pages)).filter((page) => page >= 1);
    unique.sort((a, b) => a - b);
    return unique;
  }

  function ensureObject(value) {
    return value && typeof value === 'object' ? value : {};
  }

  function ensureFileMeta(file) {
    if (!file) return {};
    const raw = ensureObject(file.raw);
    file.raw = raw;
    const meta = ensureObject(raw.meta);
    raw.meta = meta;
    return meta;
  }

  function normaliseStatus(value, fallback = 'queued') {
    if (!value && value !== 0) return fallback;
    if (typeof value === 'object' && value !== null) {
      const statusValue = value.status || value.state || value.phase;
      if (statusValue) return normaliseStatus(statusValue, fallback);
    }
    const input = String(value || '').trim().toLowerCase();
    if (!input) return fallback;
    if (STATUS_LABELS[input]) return input;
    if (LEGACY_STATUS_MAP[input]) return LEGACY_STATUS_MAP[input];
    return fallback;
  }

  function normaliseProcessingState(value, fallback = 'queued') {
    const info = ensureObject(typeof value === 'object' ? value : {});
    info.status = normaliseStatus(value && typeof value === 'object' ? value.status || value.state || value : value, fallback);
    return info;
  }

  function createStatusIndicator(label, stateValue) {
    const info = normaliseProcessingState(stateValue, 'queued');
    const statusValue = info.status || 'queued';
    const indicator = document.createElement('span');
    indicator.className = 'status-indicator';
    indicator.dataset.state = statusValue;
    indicator.setAttribute('role', 'status');
    indicator.setAttribute('tabindex', '0');
    const labelText = `${label}: ${STATUS_LABELS[statusValue] || STATUS_LABELS.queued}`;
    indicator.setAttribute('aria-label', labelText);
    indicator.title = labelText;

    let icon;
    if (statusValue === 'processing') {
      icon = document.createElement('span');
      icon.className = 'spinner-border spinner-border-sm';
      icon.setAttribute('role', 'presentation');
      icon.setAttribute('aria-hidden', 'true');
    } else {
      icon = document.createElement('i');
      const iconClass = STATUS_ICONS[statusValue] || STATUS_ICONS.queued;
      icon.className = `bi ${iconClass}`;
      icon.setAttribute('aria-hidden', 'true');
    }

    const text = document.createElement('span');
    text.className = 'status-indicator__label';
    text.textContent = STATUS_LABELS[statusValue] || STATUS_LABELS.queued;

    indicator.append(icon, text);
    return indicator;
  }

  function resolveDocId(input) {
    if (!input) return null;
    const source = input.raw && typeof input.raw === 'object' ? input.raw : input;
    const candidates = [
      input.docId,
      input.documentId,
      input.id,
      source?.docId,
      source?.documentId,
      source?.id,
      source?.fileId,
      source?.storage?.fileId,
      source?.processing?.docId,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }
    return null;
  }

  function resolveDocClass(input) {
    if (!input) return null;
    const source = input.raw && typeof input.raw === 'object' ? input.raw : input;
    const candidates = [
      source?.meta?.docClass,
      source?.meta?.doc_class,
      source?.docClass,
      source?.doc_class,
      source?.classification?.docClass,
      source?.classification?.doc_class,
      source?.docType,
      source?.documentType,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim().toLowerCase();
      }
    }
    return null;
  }

  function docHasWarning(input) {
    const source = input && input.raw && typeof input.raw === 'object' ? input.raw : input;
    if (!source) return false;
    if (source.ui && source.ui.warning) return true;
    const meta = ensureObject(source.meta);
    const trimRequired = meta.trim_required;
    const reviewState = String(meta.trim_review_state || '').trim().toLowerCase();
    if (trimRequired === false || reviewState === 'completed') return false;
    if (trimRequired === true) return true;
    if (reviewState === 'pending' || reviewState === 'required') return true;
    const pageCount = pickFirstNumber([
      meta.page_count_original,
      meta.pageCountOriginal,
      meta.originalPageCount,
      meta.original_page_count,
      meta.page_count,
      meta.pageCount,
      meta.total_pages,
      meta.totalPages,
    ]);
    return pageCount != null && pageCount > 5;
  }

  function getViewerFiles() {
    return Array.isArray(state.viewer.files) ? state.viewer.files : [];
  }

  function findViewerFileByDocId(docId) {
    if (!docId) return null;
    const normalised = String(docId).trim();
    if (!normalised) return null;
    return getViewerFiles().find((file) => resolveDocId(file) === normalised) || null;
  }

  function applyProcessingUpdate(target, updates = {}) {
    const file = typeof target === 'string' ? findViewerFileByDocId(target) : target;
    if (!file) return null;
    const raw = ensureObject(file.raw);
    file.raw = raw;
    const processing = normaliseProcessingState(raw.processing || file.processingInfo || {}, 'queued');
    if (updates.processing && typeof updates.processing === 'object') {
      Object.assign(processing, updates.processing);
    }
    if (updates.status) {
      processing.status = normaliseStatus(updates.status, processing.status || 'queued');
    }
    processing.status = normaliseStatus(processing.status, 'queued');
    raw.processing = processing;
    file.processingInfo = processing;
    file.processingStatus = processing.status;
    file.processing = processing.status;
    if (updates.meta && typeof updates.meta === 'object') {
      raw.meta = { ...ensureObject(raw.meta), ...updates.meta };
    }
    if (updates.result && typeof updates.result === 'object') {
      raw.result = { ...ensureObject(raw.result), ...updates.result };
    }
    if (updates.ui && typeof updates.ui === 'object') {
      raw.ui = { ...ensureObject(raw.ui), ...updates.ui };
    }
    return file;
  }

  function appendUiMessage(file, message) {
    if (!file || !message) return;
    const raw = ensureObject(file.raw);
    const ui = ensureObject(raw.ui);
    const messages = Array.isArray(ui.messages) ? ui.messages.slice() : [];
    if (!messages.includes(message)) {
      messages.push(message);
      ui.messages = messages;
      raw.ui = ui;
    }
  }

  function clearTrimWarning(file) {
    if (!file) return;
    const raw = ensureObject(file.raw);
    const ui = ensureObject(raw.ui);
    if (Array.isArray(ui.messages)) {
      ui.messages = ui.messages.filter((message) => message !== TRIM_AUTOTRIM_MESSAGE);
    }
    ui.warning = false;
    raw.ui = ui;
  }

  function withButtonSpinner(button, label) {
    if (!button) return () => {};
    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> ${label}`;
    return () => {
      button.innerHTML = original;
      button.disabled = false;
    };
  }

  async function requestAutoTrim(file, docId) {
    if (!docId) {
      throw new Error('Document identifier unavailable for trimming.');
    }
    const response = await apiFetch('/autotrim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docId }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || 'Auto-trim failed');
    }
    const trim = ensureObject(payload.trim);
    const trimRequired = Boolean(payload.trimRequired);
    const raw = ensureObject(file.raw);
    file.raw = raw;
    applyProcessingUpdate(file, {
      status: trimRequired ? 'idle' : 'queued',
      processing: { provider: 'docupipe' },
      meta: {
        page_count_original: trim.originalPageCount ?? trim.page_count_original ?? raw.meta?.page_count_original,
        pages_kept: trim.keptPages ?? trim.pages_kept ?? raw.meta?.pages_kept,
        trim_required: trimRequired,
        trim_review_state: trimRequired ? 'pending' : 'skipped',
      },
      ui: { warning: trimRequired },
    });
    if (trimRequired) {
      appendUiMessage(file, TRIM_AUTOTRIM_MESSAGE);
    }
    return { trim, trimRequired };
  }

  function stopProcessingPoll(docId) {
    if (!docId) return;
    const timer = processingPollers.get(docId);
    if (timer) {
      clearTimeout(timer);
      processingPollers.delete(docId);
    }
  }

  function stopAllProcessingPolls() {
    processingPollers.forEach((timer) => clearTimeout(timer));
    processingPollers.clear();
  }

  function scheduleProcessingPoll(docId) {
    stopProcessingPoll(docId);
    const timer = setTimeout(() => {
      pollProcessingStatus(docId).catch((error) => console.warn('Processing poll error', error));
    }, PROCESS_POLL_INTERVAL);
    processingPollers.set(docId, timer);
  }

  async function pollProcessingStatus(docId) {
    if (!docId) return;
    stopProcessingPoll(docId);
    const file = findViewerFileByDocId(docId);
    if (!file) return;
    try {
      const response = await apiFetch(`/status?docId=${encodeURIComponent(docId)}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || response.statusText || 'Status check failed');
      }
      if (payload?.state === 'completed') {
        applyProcessingUpdate(file, { status: 'completed' });
        renderViewerFiles();
        return;
      }
      if (payload?.state === 'failed' || payload?.ok === false) {
        const errorMessage = payload?.error || 'Processing failed';
        applyProcessingUpdate(file, {
          status: 'failed',
          processing: { error: errorMessage },
        });
        appendUiMessage(file, errorMessage);
        renderViewerFiles();
        return;
      }
      scheduleProcessingPoll(docId);
    } catch (error) {
      console.warn('Processing status poll failed', error);
      appendUiMessage(file, error?.message || 'Processing status check failed');
      renderViewerFiles();
    }
  }

  function startProcessingPoll(docId) {
    if (!docId) return;
    pollProcessingStatus(docId).catch((error) => console.warn('Initial processing poll failed', error));
  }

  function pickMetric(metrics, keys) {
    if (!metrics) return null;
    for (const key of keys) {
      if (metrics[key] != null) return metrics[key];
    }
    return null;
  }

  function normaliseStatementName(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return 'Institution';
    return trimmed.replace(/^statement\s+/i, '').trim() || trimmed;
  }

  function normalisePayslipViewerFiles(files, { employerName = '', includeEmployerInSummary = false } = {}) {
    const employerLabel = employerName || '';
    const normalised = Array.isArray(files) ? files : [];
    const mapped = normalised.map((file) => {
      const metrics = file?.metrics || {};
      const currency = metrics.currency || metrics.currencyCode || 'GBP';
      const payDateValue = metrics.payDate || file.documentDate || file.documentMonth;
      const sortDate = toDateLike(payDateValue);
      const totalEarnings = pickMetric(metrics, ['totalEarnings', 'gross', 'grossPay']);
      const totalDeductions = pickMetric(metrics, ['totalDeductions', 'totalDeductibles', 'deductionsTotal']);
      const netPay = pickMetric(metrics, ['net', 'netPay', 'takeHome']);
      const details = [];
      const periodStart = metrics.periodStart || metrics.period?.start || metrics.periodStartDate || metrics.period?.from;
      const periodEnd = metrics.periodEnd || metrics.period?.end || metrics.periodEndDate || metrics.period?.to;
      if (periodStart) details.push({ label: 'Period start', value: formatDate(periodStart) });
      if (periodEnd) details.push({ label: 'Period end', value: formatDate(periodEnd) });
      if (metrics.payFrequency) details.push({ label: 'Pay frequency', value: metrics.payFrequency });
      if (metrics.taxCode) details.push({ label: 'Tax code', value: metrics.taxCode });
      if (metrics.tax != null) details.push({ label: 'Income tax', value: formatMoney(metrics.tax, currency) });
      if (metrics.ni != null) details.push({ label: 'National Insurance', value: formatMoney(metrics.ni, currency) });
      if (metrics.pension != null) details.push({ label: 'Pension', value: formatMoney(metrics.pension, currency) });
      if (metrics.studentLoan != null) details.push({ label: 'Student loan', value: formatMoney(metrics.studentLoan, currency) });

      const subtitleParts = [];
      if (includeEmployerInSummary && employerLabel) subtitleParts.push(employerLabel);
      if (metrics.payFrequency) subtitleParts.push(`${metrics.payFrequency} payslip`);

      const summary = [
        { label: 'Date of payslip', value: formatDate(payDateValue) },
        { label: 'Total earnings', value: formatMoney(totalEarnings, currency) },
        { label: 'Total deductibles', value: formatMoney(totalDeductions, currency) },
        { label: 'Net pay', value: formatMoney(netPay, currency) },
      ];
      if (includeEmployerInSummary) {
        summary.unshift({ label: 'Employer', value: employerLabel || file?.metadata?.employerName || '—' });
      }

      const viewerFile = {
        fileId: file.fileId,
        title: formatDate(payDateValue) || 'Payslip',
        subtitle: subtitleParts.join(' · ') || (metrics.payFrequency ? `${metrics.payFrequency} payslip` : 'Payslip'),
        summary,
        details,
        metrics,
        raw: file,
        currency,
        isExpanded: false,
      };
      viewerFile._sortValue = sortDate ? sortDate.getTime() : 0;
      return viewerFile;
    });

    return mapped
      .sort((a, b) => (b._sortValue || 0) - (a._sortValue || 0))
      .map((file) => {
        delete file._sortValue;
        return file;
      });
  }

  function normaliseStatementViewerFiles(accounts, { institutionName = '', includeInstitutionInSummary = false } = {}) {
    const list = Array.isArray(accounts) ? accounts : [];
    const files = [];
    const institutionLabel = normaliseStatementName(institutionName || '');

    list.forEach((account) => {
      const accountName = account?.displayName || institutionLabel;
      const maskedNumber = account?.accountNumberMasked || null;
      const accountType = account?.accountType || null;
      const accountFiles = Array.isArray(account?.files) ? account.files : [];

      accountFiles.forEach((file) => {
        const metrics = file?.metrics || {};
        const currency = metrics.currency || metrics.currencyCode || 'GBP';
        const totalIn = pickMetric(metrics, ['totalIn', 'totalCredit', 'totalCredits', 'sumCredits', 'creditsTotal']);
        const totalOut = pickMetric(metrics, ['totalOut', 'totalDebit', 'totalDebits', 'sumDebits', 'debitsTotal']);
        const periodStart = metrics.periodStart || metrics.period?.start || metrics.period?.from || metrics.statementPeriod?.start;
        const periodEnd = metrics.periodEnd || metrics.period?.end || metrics.period?.to || metrics.statementPeriod?.end;
        const openingBalance = pickMetric(metrics, ['openingBalance', 'startingBalance']);
        const closingBalance = pickMetric(metrics, ['closingBalance', 'endingBalance']);
        const summary = [
          { label: 'Account number', value: file.accountNumberMasked || maskedNumber || '—' },
          { label: 'Total in', value: formatMoney(totalIn, currency) },
          { label: 'Total out', value: formatMoney(totalOut, currency) },
        ];
        if (includeInstitutionInSummary) {
          summary.unshift({ label: 'Institution', value: institutionLabel || '—' });
        }

        const details = [];
        if (periodStart) details.push({ label: 'Period start', value: formatDate(periodStart) });
        if (periodEnd) details.push({ label: 'Period end', value: formatDate(periodEnd) });
        if (openingBalance != null) details.push({ label: 'Opening balance', value: formatMoney(openingBalance, currency) });
        if (closingBalance != null) details.push({ label: 'Closing balance', value: formatMoney(closingBalance, currency) });
        if (metrics.currency) details.push({ label: 'Currency', value: metrics.currency });
        if (accountType) details.push({ label: 'Account type', value: accountType });

        const subtitleParts = [];
        if (includeInstitutionInSummary && institutionLabel) {
          subtitleParts.push(institutionLabel);
        }
        if (periodEnd) {
          subtitleParts.push(`Statement ending ${formatDate(periodEnd)}`);
        } else if (file.documentDate) {
          subtitleParts.push(`Statement ${formatDate(file.documentDate)}`);
        } else if (file.documentMonth) {
          subtitleParts.push(`Statement ${formatDate(file.documentMonth)}`);
        }

        const viewerFile = {
          fileId: file.fileId,
          title: accountName || 'Statement',
          subtitle: subtitleParts.join(' · ') || institutionLabel || 'Statement',
          summary,
          details,
          metrics,
          raw: file,
          currency,
          isExpanded: false,
        };
        const sortDate = toDateLike(periodEnd || file.documentDate || file.documentMonth);
        viewerFile._sortValue = sortDate ? sortDate.getTime() : 0;
        files.push(viewerFile);
      });
    });

    return files
      .sort((a, b) => (b._sortValue || 0) - (a._sortValue || 0))
      .map((file) => {
        delete file._sortValue;
        return file;
      });
  }

  function getSelectedCollection() {
    if (!state.selectedCollectionId) return null;
    return state.collections.find((col) => col.id === state.selectedCollectionId) || null;
  }

  function updateCollectionTargetHint() {
    if (!collectionTarget) return;
    const label = collectionTarget.querySelector('strong');
    const selected = getSelectedCollection();
    if (selected) {
      collectionTarget.hidden = false;
      if (label) label.textContent = selected.name || 'Collection';
    } else {
      collectionTarget.hidden = true;
    }
  }

  function authFetch(path, options) {
    if (window.Auth && typeof Auth.fetch === 'function') {
      return Auth.fetch(path, options);
    }
    return fetch(path, options);
  }

  function setProgress({ phase, completed, total, countLabel }) {
    if (!(progressContainer && progressPhase && progressCount && progressBar)) return;
    progressContainer.hidden = false;
    progressContainer.setAttribute('aria-hidden', 'false');
    progressPhase.textContent = phase;
    const safeTotal = Math.max(0, total || 0);
    let safeCompleted = Math.max(0, completed || 0);
    if (safeTotal) {
      safeCompleted = Math.min(safeCompleted, safeTotal);
    }
    progressBar.setAttribute('aria-label', phase);
    if (countLabel != null) {
      progressCount.textContent = countLabel;
    } else {
      progressCount.textContent = safeTotal ? `${safeCompleted}/${safeTotal} complete` : '';
    }
    const pct = safeTotal ? Math.round((safeCompleted / safeTotal) * 100) : safeCompleted ? 100 : 0;
    progressBar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    progressBar.setAttribute('aria-valuenow', String(Math.max(0, Math.min(100, pct))));
  }

  function hideProgress() {
    if (!(progressContainer && progressBar)) return;
    progressContainer.hidden = true;
    progressContainer.setAttribute('aria-hidden', 'true');
    progressBar.style.width = '0%';
    progressBar.setAttribute('aria-valuenow', '0');
  }

  function updateProgressUI() {
    if (!(progressContainer && progressPhase && progressCount && progressBar)) return;
    const placeholders = Array.from(state.placeholders.values());
    if (placeholders.length) {
      const total = placeholders.reduce((sum, item) => sum + (item.total || 1), 0);
      const completed = placeholders.reduce((sum, item) => sum + (item.completed || 0), 0);
      const hasZip = placeholders.some((item) => item.phase === 'Extracting zip');
      const phaseLabel = hasZip ? 'Extracting zip' : 'Uploading files';
      const countLabel = total ? `${completed}/${total} complete` : 'Preparing…';
      const phaseWithCount = total ? `${phaseLabel} (${completed}/${total})` : phaseLabel;
      setProgress({ phase: phaseWithCount, completed, total, countLabel });
      return;
    }

    const totalFiles = state.files.size;
    if (!totalFiles) {
      hideProgress();
      return;
    }

    const records = Array.from(state.files.values());
    const uploadCompleted = records.filter((file) => normaliseStatus(file.upload, 'completed') === 'completed').length;
    const processingCompleted = records.filter((file) => normaliseStatus(file.processing, 'queued') === 'completed').length;

    if (uploadCompleted < totalFiles) {
      const phase = `Uploading files (${uploadCompleted}/${totalFiles})`;
      setProgress({ phase, completed: uploadCompleted, total: totalFiles, countLabel: `${uploadCompleted}/${totalFiles} complete` });
      return;
    }

    if (processingCompleted < totalFiles) {
      const phase = `Extracting analytics (${processingCompleted}/${totalFiles})`;
      setProgress({ phase, completed: processingCompleted, total: totalFiles, countLabel: `${processingCompleted}/${totalFiles} complete` });
      return;
    }

    const phase = `All files processed (${totalFiles}/${totalFiles})`;
    setProgress({ phase, completed: totalFiles, total: totalFiles, countLabel: `${totalFiles}/${totalFiles} complete` });
  }

  function closeViewer() {
    if (!viewerRoot) return;
    viewerPreviewToken += 1;
    stopAllProcessingPolls();
    viewerRoot.setAttribute('aria-hidden', 'true');
    if (viewerFrame) {
      viewerFrame.src = 'about:blank';
    }
    if (viewerPreviewUrl) {
      URL.revokeObjectURL(viewerPreviewUrl);
      viewerPreviewUrl = null;
    }
    if (viewerEmpty) {
      viewerEmpty.style.display = '';
      viewerEmpty.textContent = 'Select a file to see the preview and actions.';
    }
    state.viewer = { type: null, context: null, files: [], selectedFileId: null };
  }

  function renderViewerSelection() {
    if (!viewerList) return;
    const cards = viewerList.querySelectorAll('.viewer__file');
    cards.forEach((card) => {
      const isSelected = card.dataset.fileId === state.viewer.selectedFileId;
      card.classList.toggle('is-selected', isSelected);
    });
  }

  async function previewViewerFile(fileId) {
    if (!viewerFrame || !fileId) return;
    const requestId = ++viewerPreviewToken;
    try {
      viewerFrame.src = 'about:blank';
      if (viewerEmpty) {
        viewerEmpty.style.display = 'none';
      }
      const response = await authFetch(`${API_BASE}/files/${encodeURIComponent(fileId)}/view`);
      if (response.status === 401) {
        handleUnauthorised('Please sign in again to preview documents.');
        return;
      }
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(text || 'Preview failed');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      if (requestId !== viewerPreviewToken) {
        URL.revokeObjectURL(url);
        return;
      }
      if (viewerPreviewUrl) {
        URL.revokeObjectURL(viewerPreviewUrl);
      }
      viewerPreviewUrl = url;
      viewerFrame.src = url;
    } catch (error) {
      console.error('Failed to preview document', error);
      if (viewerEmpty) {
        viewerEmpty.style.display = '';
        viewerEmpty.textContent = 'Preview unavailable for this file.';
      }
      if (viewerFrame) {
        viewerFrame.src = 'about:blank';
      }
      window.alert(error.message || 'Unable to preview this document right now.');
    }
  }

  function selectViewerFile(fileId, { preview = false } = {}) {
    state.viewer.selectedFileId = fileId;
    renderViewerSelection();
    if (preview) {
      previewViewerFile(fileId);
    }
  }

  function injectJsonModalStyles() {
    if (jsonModalStylesInjected) return;
    jsonModalStylesInjected = true;
    const style = document.createElement('style');
    style.textContent = `
      .vault-json-modal { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; background: rgba(15, 23, 42, 0.55); padding: 24px; z-index: 1300; }
      .vault-json-modal.is-visible { display: flex; }
      .vault-json-modal__dialog { position: relative; width: min(760px, 100%); max-height: min(85vh, 700px); background: var(--vault-card-bg, #fff); color: var(--bs-body-color, #0f172a); border-radius: var(--vault-radius, 18px); box-shadow: var(--vault-shadow, 0 16px 48px rgba(15, 23, 42, 0.12)); border: 1px solid var(--vault-border, rgba(15, 23, 42, 0.08)); display: flex; flex-direction: column; overflow: hidden; }
      .vault-json-modal__header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 20px; border-bottom: 1px solid rgba(15, 23, 42, 0.08); }
      .vault-json-modal__title { margin: 0; font-size: 1rem; font-weight: 600; }
      .vault-json-modal__close { border: none; background: transparent; color: inherit; font-size: 1.5rem; line-height: 1; cursor: pointer; padding: 4px; }
      .vault-json-modal__close:focus-visible { outline: 2px solid var(--vault-accent, #6759ff); outline-offset: 2px; }
      .vault-json-modal__meta { padding: 12px 20px 0; font-size: 0.85rem; color: var(--viewer-muted, rgba(15, 23, 42, 0.6)); display: flex; flex-direction: column; gap: 12px; max-height: 160px; overflow: auto; }
      .vault-json-modal__meta-item { display: flex; flex-direction: column; gap: 4px; }
      .vault-json-modal__meta-item code { display: block; white-space: pre-wrap; font-size: 0.75rem; }
      .vault-json-modal__content { flex: 1; margin: 0; padding: 16px 20px 20px; background: rgba(15, 23, 42, 0.03); font-family: 'SFMono-Regular', 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 0.85rem; line-height: 1.45; overflow: auto; white-space: pre-wrap; word-break: break-word; color: inherit; }
    `;
    document.head.appendChild(style);
  }

  function ensureJsonModal() {
    if (jsonModal) return jsonModal;
    injectJsonModalStyles();

    const modal = document.createElement('div');
    modal.className = 'vault-json-modal';
    modal.setAttribute('aria-hidden', 'true');

    const dialog = document.createElement('div');
    dialog.className = 'vault-json-modal__dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'vault-json-modal-title');

    const header = document.createElement('header');
    header.className = 'vault-json-modal__header';

    const title = document.createElement('h4');
    title.className = 'vault-json-modal__title';
    title.id = 'vault-json-modal-title';
    title.textContent = 'Processed JSON';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'vault-json-modal__close';
    closeBtn.setAttribute('aria-label', 'Close JSON view');
    closeBtn.textContent = '×';

    const meta = document.createElement('div');
    meta.className = 'vault-json-modal__meta';
    meta.hidden = true;

    const content = document.createElement('pre');
    content.className = 'vault-json-modal__content';

    header.append(title, closeBtn);
    dialog.append(header, meta, content);
    modal.appendChild(dialog);
    document.body.appendChild(modal);

    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        hideJsonModal();
      }
    });

    closeBtn.addEventListener('click', (event) => {
      event.preventDefault();
      hideJsonModal();
    });

    jsonModal = modal;
    jsonModalTitle = title;
    jsonModalMeta = meta;
    jsonModalContent = content;
    jsonModalClose = closeBtn;
    return modal;
  }

  function hideJsonModal() {
    if (!jsonModal) return;
    jsonModal.classList.remove('is-visible');
    jsonModal.setAttribute('aria-hidden', 'true');
    if (jsonModalContent) {
      jsonModalContent.textContent = '';
      jsonModalContent.scrollTop = 0;
    }
    if (jsonModalMeta) {
      jsonModalMeta.textContent = '';
      jsonModalMeta.hidden = true;
    }
    const returnTarget = jsonModalReturnFocus;
    jsonModalReturnFocus = null;
    if (returnTarget && typeof returnTarget.focus === 'function') {
      requestAnimationFrame(() => {
        try { returnTarget.focus(); } catch (error) { console.warn('Failed to restore focus after closing JSON modal', error); }
      });
    }
  }

  function buildJsonPayload(file) {
    if (!file) return null;
    if (file.raw && typeof file.raw === 'object') {
      return file.raw;
    }
    const payload = {};
    if (file.fileId || file.id) payload.fileId = file.fileId || file.id;
    if (file.title) payload.title = file.title;
    if (file.subtitle) payload.subtitle = file.subtitle;
    if (file.metrics) payload.metrics = file.metrics;
    if (file.metadata) payload.metadata = file.metadata;
    if (Array.isArray(file.summary)) payload.summary = file.summary;
    if (Array.isArray(file.details)) payload.details = file.details;
    return Object.keys(payload).length ? payload : null;
  }

  async function showProcessedJson(file, trigger) {
    const docId = resolveDocId(file);
    if (!docId) {
      window.alert('Processed JSON is unavailable for this document.');
      return;
    }

    const restore = trigger ? withButtonSpinner(trigger, 'Loading…') : () => {};
    try {
      const response = await apiFetch(`/json?docId=${encodeURIComponent(docId)}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok || typeof payload.json === 'undefined') {
        throw new Error(payload?.error || 'Processed JSON unavailable');
      }

      const modal = ensureJsonModal();
      if (!modal || !jsonModalContent) {
        throw new Error('Unable to display JSON right now.');
      }

      if (jsonModalTitle) {
        jsonModalTitle.textContent = file?.title ? `${file.title} — Processed JSON` : 'Processed JSON';
      }
      if (jsonModalMeta) {
        jsonModalMeta.innerHTML = '';
        const sections = [
          ['Meta', ensureObject(file.raw?.meta)],
          ['Processing', ensureObject(file.raw?.processing)],
          ['Result', ensureObject(file.raw?.result)],
        ];
        sections.forEach(([label, data]) => {
          if (!data || !Object.keys(data).length) return;
          const item = document.createElement('div');
          item.className = 'vault-json-modal__meta-item';
          const name = document.createElement('strong');
          name.textContent = `${label}:`;
          const value = document.createElement('code');
          value.textContent = JSON.stringify(data, null, 2);
          item.append(name, value);
          jsonModalMeta.appendChild(item);
        });
        jsonModalMeta.hidden = jsonModalMeta.childElementCount === 0;
        jsonModalMeta.scrollTop = 0;
      }

      try {
        jsonModalContent.textContent = JSON.stringify(payload.json, null, 2);
      } catch (error) {
        console.error('Failed to serialise processed JSON payload', error);
        jsonModalContent.textContent = 'Unable to serialise processed JSON payload.';
      }
      jsonModalContent.scrollTop = 0;

      jsonModalReturnFocus = trigger || null;
      modal.classList.add('is-visible');
      modal.setAttribute('aria-hidden', 'false');
      if (jsonModalClose) {
        jsonModalClose.focus();
      }
    } catch (error) {
      console.error('Processed JSON preview failed', error);
      window.alert(error.message || 'Unable to load processed JSON right now.');
    } finally {
      restore();
    }
  }

  function showJsonForFile(file, trigger) {
    if (!jsonTestEnabled) return;
    const payload = buildJsonPayload(file);
    if (!payload) {
      window.alert('Processed JSON is unavailable for this document.');
      return;
    }

    const modal = ensureJsonModal();
    if (!modal || !jsonModalContent) {
      window.alert('Unable to display JSON right now.');
      return;
    }

    let text = '';
    try {
      text = JSON.stringify(payload, null, 2);
    } catch (error) {
      console.error('Failed to serialise document JSON', error);
      text = 'Unable to serialise this document\'s JSON payload.';
    }

    if (jsonModalTitle) {
      jsonModalTitle.textContent = file?.title ? `${file.title} — JSON` : 'Processed JSON';
    }
    if (jsonModalMeta) {
      const parts = [];
      if (file?.subtitle) parts.push(file.subtitle);
      if (file?.fileId) parts.push(`ID: ${file.fileId}`);
      if (file?.raw?.catalogueKey) parts.push(file.raw.catalogueKey);
      jsonModalMeta.textContent = parts.join(' • ');
      jsonModalMeta.hidden = parts.length === 0;
    }
    jsonModalContent.textContent = text;
    jsonModalContent.scrollTop = 0;

    jsonModalReturnFocus = trigger || null;
    modal.classList.add('is-visible');
    modal.setAttribute('aria-hidden', 'false');
    if (jsonModalClose) {
      jsonModalClose.focus();
    }
  }

  function injectTrimModalStyles() {
    if (trimModalStylesInjected) return;
    trimModalStylesInjected = true;
    const style = document.createElement('style');
    style.textContent = `
      .vault-trim-modal { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; padding: 24px; background: var(--viewer-overlay, rgba(15, 23, 42, 0.45)); z-index: 1250; }
      .vault-trim-modal.is-visible { display: flex; }
      .vault-trim-modal__dialog { position: relative; width: min(520px, 100%); max-height: min(90vh, 640px); background: var(--viewer-bg, rgba(255, 255, 255, 0.98)); color: var(--bs-body-color, #0f172a); border-radius: var(--vault-radius, 18px); border: 1px solid var(--vault-border, rgba(15, 23, 42, 0.08)); box-shadow: var(--vault-shadow, 0 16px 48px rgba(15, 23, 42, 0.12)); display: flex; flex-direction: column; outline: none; }
      .vault-trim-modal__header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 20px; border-bottom: 1px solid rgba(15, 23, 42, 0.08); }
      .vault-trim-modal__title { margin: 0; font-size: 1rem; font-weight: 600; }
      .vault-trim-modal__close { border: none; background: transparent; color: inherit; font-size: 1.5rem; line-height: 1; padding: 4px; cursor: pointer; }
      .vault-trim-modal__close:focus-visible { outline: 2px solid var(--vault-accent, #6759ff); outline-offset: 2px; }
      .vault-trim-modal__form { display: flex; flex-direction: column; flex: 1; min-height: 0; }
      .vault-trim-modal__body { padding: 16px 20px; display: flex; flex-direction: column; gap: 12px; flex: 1; overflow: hidden; }
      .vault-trim-modal__description { margin: 0; font-size: 0.9rem; color: var(--viewer-muted, rgba(15, 23, 42, 0.7)); }
      .vault-trim-modal__meta { margin: 0; font-size: 0.85rem; color: var(--viewer-muted, rgba(15, 23, 42, 0.6)); }
      .vault-trim-modal__loading { margin: 0; font-size: 0.85rem; color: var(--viewer-muted, rgba(15, 23, 42, 0.6)); }
      .vault-trim-modal__error { margin: 0; font-size: 0.85rem; color: var(--light-red, #ef4444); }
      .vault-trim-modal__pages { flex: 1; display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; padding: 12px; border-radius: 12px; border: 1px solid rgba(15, 23, 42, 0.08); background: rgba(15, 23, 42, 0.03); overflow: auto; min-height: 120px; }
      .vault-trim-modal__page { display: flex; align-items: center; gap: 8px; font-size: 0.9rem; cursor: pointer; }
      .vault-trim-modal__page input { cursor: pointer; }
      .vault-trim-modal__empty { margin: 0; font-size: 0.85rem; color: var(--viewer-muted, rgba(15, 23, 42, 0.6)); }
      .vault-trim-modal__footer { display: flex; justify-content: flex-end; gap: 12px; padding: 16px 20px; border-top: 1px solid rgba(15, 23, 42, 0.08); }
      @media (max-width: 600px) { .vault-trim-modal { padding: 16px; } .vault-trim-modal__dialog { width: 100%; max-height: 100vh; } }
    `;
    document.head.appendChild(style);
  }

  function ensureTrimModal() {
    if (trimModal) return trimModal;
    injectTrimModalStyles();

    let modal = document.getElementById('vault-trim-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'vault-trim-modal';
      modal.id = 'vault-trim-modal';
      modal.setAttribute('aria-hidden', 'true');
      modal.setAttribute('hidden', '');

      const dialog = document.createElement('div');
      dialog.className = 'vault-trim-modal__dialog';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-labelledby', 'vault-trim-modal-title');
      dialog.setAttribute('aria-describedby', 'vault-trim-modal-description');
      dialog.tabIndex = -1;

      const header = document.createElement('header');
      header.className = 'vault-trim-modal__header';

      const title = document.createElement('h4');
      title.className = 'vault-trim-modal__title';
      title.id = 'vault-trim-modal-title';
      title.textContent = 'Review Trim';

      const closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.className = 'vault-trim-modal__close';
      closeButton.setAttribute('aria-label', 'Close trim review');
      closeButton.textContent = '×';

      header.append(title, closeButton);

      const form = document.createElement('form');
      form.className = 'vault-trim-modal__form';
      form.id = 'vault-trim-modal-form';

      const body = document.createElement('div');
      body.className = 'vault-trim-modal__body';

      const description = document.createElement('p');
      description.className = 'vault-trim-modal__description';
      description.id = 'vault-trim-modal-description';
      description.textContent = 'Choose which pages to keep before processing. Unselected pages will be removed.';

      const meta = document.createElement('p');
      meta.className = 'vault-trim-modal__meta muted';
      meta.hidden = true;

      const loading = document.createElement('p');
      loading.className = 'vault-trim-modal__loading muted';
      loading.hidden = true;
      loading.textContent = 'Loading page suggestions…';

      const error = document.createElement('p');
      error.className = 'vault-trim-modal__error';
      error.hidden = true;

      const pages = document.createElement('div');
      pages.className = 'vault-trim-modal__pages';

      body.append(description, meta, loading, error, pages);

      const footer = document.createElement('footer');
      footer.className = 'vault-trim-modal__footer';

      const cancelButton = document.createElement('button');
      cancelButton.type = 'button';
      cancelButton.className = 'btn btn-outline-secondary vault-trim-modal__cancel';
      cancelButton.textContent = 'Cancel';

      const applyButton = document.createElement('button');
      applyButton.type = 'submit';
      applyButton.className = 'btn btn-primary vault-trim-modal__apply';
      applyButton.textContent = 'Apply & Queue';
      applyButton.disabled = true;

      footer.append(cancelButton, applyButton);
      form.append(body, footer);
      dialog.append(header, form);
      modal.appendChild(dialog);
      document.body.appendChild(modal);
    }

    trimModal = modal;
    trimModalDialog = modal.querySelector('.vault-trim-modal__dialog');
    if (trimModalDialog && !trimModalDialog.hasAttribute('tabindex')) {
      trimModalDialog.tabIndex = -1;
    }
    trimModalTitle = modal.querySelector('.vault-trim-modal__title');
    trimModalMeta = modal.querySelector('.vault-trim-modal__meta');
    trimModalList = modal.querySelector('.vault-trim-modal__pages');
    trimModalLoading = modal.querySelector('.vault-trim-modal__loading');
    trimModalError = modal.querySelector('.vault-trim-modal__error');
    trimModalForm = modal.querySelector('.vault-trim-modal__form');
    trimModalApply = modal.querySelector('.vault-trim-modal__apply') || modal.querySelector('.vault-trim-modal__form button[type="submit"]');
    trimModalCancel = modal.querySelector('.vault-trim-modal__cancel');
    trimModalClose = modal.querySelector('.vault-trim-modal__close');

    if (!modal.dataset.trimInitialised) {
      modal.addEventListener('click', (event) => {
        if (event.target === modal) {
          hideTrimModal();
        }
      });
      if (trimModalCancel) {
        trimModalCancel.addEventListener('click', (event) => {
          event.preventDefault();
          hideTrimModal();
        });
      }
      if (trimModalClose) {
        trimModalClose.addEventListener('click', (event) => {
          event.preventDefault();
          hideTrimModal();
        });
      }
      if (trimModalForm) {
        trimModalForm.addEventListener('submit', (event) => {
          event.preventDefault();
          submitTrimReview();
        });
      }
      modal.dataset.trimInitialised = 'true';
    }

    return modal;
  }

  function updateTrimModalMeta() {
    if (!trimModalMeta) return;
    const file = trimReviewState.file;
    const raw = ensureObject(file?.raw);
    const parts = [];
    const docParts = [];
    if (file?.title) docParts.push(file.title);
    if (file?.subtitle) docParts.push(file.subtitle);
    if (!docParts.length && raw?.originalName) docParts.push(raw.originalName);
    if (!docParts.length && file?.originalName) docParts.push(file.originalName);
    if (docParts.length) {
      parts.push(docParts.join(' — '));
    }
    const pageCount = trimReviewState.pageCount;
    if (pageCount) {
      parts.push(`${pageCount} page${pageCount === 1 ? '' : 's'}`);
    }
    const keptCount = trimReviewState.keptPages instanceof Set ? trimReviewState.keptPages.size : 0;
    if (keptCount) {
      parts.push(`Keeping ${keptCount} page${keptCount === 1 ? '' : 's'}`);
    }
    trimModalMeta.textContent = parts.join(' • ');
    trimModalMeta.hidden = parts.length === 0;
  }

  function updateTrimModalApplyState() {
    if (trimModalApply) {
      trimModalApply.disabled = trimReviewState.keptPages.size === 0 || trimReviewState.isSubmitting;
    }
    if (trimModalError && trimModalError.dataset && trimModalError.dataset.trimContext === 'selection' && trimReviewState.keptPages.size > 0) {
      trimModalError.hidden = true;
      trimModalError.textContent = '';
      trimModalError.dataset.trimContext = '';
    }
  }

  function renderTrimModalPages() {
    if (!trimModalList) return;
    trimModalList.innerHTML = '';
    if (!(trimReviewState.keptPages instanceof Set)) {
      trimReviewState.keptPages = new Set();
    }
    const { pageCount, keptPages } = trimReviewState;
    if (!pageCount || pageCount < 1) {
      const empty = document.createElement('p');
      empty.className = 'vault-trim-modal__empty';
      empty.textContent = 'Page information unavailable.';
      trimModalList.appendChild(empty);
      updateTrimModalApplyState();
      updateTrimModalMeta();
      return;
    }

    for (let page = 1; page <= pageCount; page += 1) {
      const label = document.createElement('label');
      label.className = 'vault-trim-modal__page';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = String(page);
      checkbox.checked = keptPages.has(page);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          keptPages.add(page);
        } else {
          keptPages.delete(page);
        }
        updateTrimModalMeta();
        updateTrimModalApplyState();
      });

      const caption = document.createElement('span');
      caption.textContent = `Page ${page}`;

      label.append(checkbox, caption);
      trimModalList.appendChild(label);
    }

    updateTrimModalMeta();
    updateTrimModalApplyState();
  }

  function focusFirstTrimCheckbox() {
    if (!trimModalList) return;
    const target =
      trimModalList.querySelector('input[type="checkbox"]:checked') ||
      trimModalList.querySelector('input[type="checkbox"]');
    if (target && typeof target.focus === 'function') {
      requestAnimationFrame(() => {
        try {
          target.focus();
        } catch (error) {
          console.warn('Failed to focus trim checkbox', error);
        }
      });
    }
  }

  async function prepareTrimReviewData(file, docId) {
    const resolvedFile = findViewerFileByDocId(docId) || file;
    if (!resolvedFile) {
      throw new Error('Document unavailable for trim review.');
    }
    const meta = ensureFileMeta(resolvedFile);

    let pageCount = pickFirstNumber([
      meta.page_count_original,
      meta.pageCountOriginal,
      meta.originalPageCount,
      meta.original_page_count,
      meta.page_count,
      meta.pageCount,
      meta.total_pages,
      meta.totalPages,
    ]);

    let keptPages = normalisePageNumbers(
      meta.pages_kept ?? meta.pagesKept ?? meta.keptPages ?? meta.trim_pages_kept ?? meta.trimPagesKept ?? meta.pages
    );

    if ((!pageCount || !keptPages.length) && docId) {
      const { trim } = await requestAutoTrim(resolvedFile, docId);
      const refreshedMeta = ensureFileMeta(resolvedFile);
      pageCount =
        pickFirstNumber([
          refreshedMeta.page_count_original,
          refreshedMeta.pageCountOriginal,
          refreshedMeta.originalPageCount,
          refreshedMeta.original_page_count,
          trim?.originalPageCount,
          trim?.page_count_original,
        ]) || pageCount;
      const updatedPages =
        refreshedMeta.pages_kept ??
        refreshedMeta.pagesKept ??
        refreshedMeta.keptPages ??
        trim?.keptPages ??
        trim?.pages_kept;
      keptPages = normalisePageNumbers(updatedPages);
      renderViewerFiles();
      queueRefresh();
    }

    if (keptPages.length) {
      const maxPage = Math.max(...keptPages);
      if (!pageCount || maxPage > pageCount) {
        pageCount = maxPage;
      }
    }

    if (!pageCount) {
      const fallbackCount = pickFirstNumber([
        meta.page_count_trimmed,
        meta.pageCountTrimmed,
        meta.pages_total,
        meta.pagesTotal,
      ]);
      if (fallbackCount) pageCount = fallbackCount;
    }

    if (!pageCount) {
      throw new Error('Page information unavailable for this document.');
    }

    if (!keptPages.length) {
      keptPages = Array.from({ length: pageCount }, (_, index) => index + 1);
    }

    return { file: resolvedFile, pageCount, keptPages };
  }

  function hideTrimModal() {
    if (!trimModal) return;
    trimModal.classList.remove('is-visible');
    trimModal.setAttribute('aria-hidden', 'true');
    trimModal.setAttribute('hidden', '');
    if (trimModalForm) {
      trimModalForm.hidden = true;
    }
    if (trimModalLoading) {
      trimModalLoading.hidden = true;
    }
    if (trimModalError) {
      trimModalError.hidden = true;
      trimModalError.textContent = '';
      if (trimModalError.dataset) trimModalError.dataset.trimContext = '';
    }
    if (trimModalMeta) {
      trimModalMeta.hidden = true;
      trimModalMeta.textContent = '';
    }
    if (trimModalList) {
      trimModalList.innerHTML = '';
    }
    trimReviewState.docId = null;
    trimReviewState.file = null;
    trimReviewState.pageCount = 0;
    trimReviewState.keptPages = new Set();
    trimReviewState.isLoading = false;
    trimReviewState.isSubmitting = false;
    const returnTarget = trimModalReturnFocus;
    trimModalReturnFocus = null;
    if (returnTarget && typeof returnTarget.focus === 'function') {
      requestAnimationFrame(() => {
        try {
          returnTarget.focus();
        } catch (error) {
          console.warn('Failed to restore focus after closing trim review', error);
        }
      });
    }
  }

  async function openTrimReview(file, trigger) {
    if (trimReviewState.isLoading) return;
    const docId = resolveDocId(file);
    if (!docId) {
      window.alert('Unable to review trim because the document identifier is unavailable.');
      return;
    }

    const modal = ensureTrimModal();
    if (!modal) {
      window.alert('Trim review unavailable right now.');
      return;
    }

    trimReviewState.isLoading = true;
    trimReviewState.docId = docId;
    trimReviewState.file = findViewerFileByDocId(docId) || file;
    trimReviewState.pageCount = 0;
    trimReviewState.keptPages = new Set();
    trimReviewState.isSubmitting = false;

    trimModalReturnFocus = trigger || document.activeElement || null;

    if (trimModalTitle) {
      trimModalTitle.textContent = 'Review Trim';
    }
    if (trimModalError) {
      trimModalError.hidden = true;
      trimModalError.textContent = '';
      if (trimModalError.dataset) trimModalError.dataset.trimContext = '';
    }
    if (trimModalLoading) {
      trimModalLoading.hidden = false;
      trimModalLoading.textContent = 'Loading page suggestions…';
    }
    if (trimModalForm) {
      trimModalForm.hidden = true;
    }
    if (trimModalApply) {
      trimModalApply.disabled = true;
    }
    if (trimModalCancel) {
      trimModalCancel.disabled = false;
    }
    if (trimModalMeta) {
      trimModalMeta.textContent = '';
      trimModalMeta.hidden = true;
    }

    updateTrimModalMeta();

    modal.classList.add('is-visible');
    modal.removeAttribute('hidden');
    modal.setAttribute('aria-hidden', 'false');
    if (trimModalDialog) {
      trimModalDialog.focus();
    }

    try {
      const { file: resolvedFile, pageCount, keptPages } = await prepareTrimReviewData(trimReviewState.file, docId);
      trimReviewState.file = resolvedFile;
      trimReviewState.pageCount = pageCount;
      trimReviewState.keptPages = new Set(keptPages);
      if (trimModalLoading) {
        trimModalLoading.hidden = true;
      }
      if (trimModalForm) {
        trimModalForm.hidden = false;
      }
      renderTrimModalPages();
      focusFirstTrimCheckbox();
    } catch (error) {
      console.error('Failed to load trim review data', error);
      if (trimModalLoading) {
        trimModalLoading.hidden = true;
      }
      if (trimModalError) {
        trimModalError.textContent = error.message || 'Unable to load trim suggestions right now.';
        trimModalError.hidden = false;
        if (trimModalError.dataset) trimModalError.dataset.trimContext = 'load';
      }
      updateTrimModalApplyState();
    } finally {
      trimReviewState.isLoading = false;
    }
  }

  async function submitTrimReview() {
    if (trimReviewState.isSubmitting) return;
    const docId = trimReviewState.docId;
    if (!docId) {
      hideTrimModal();
      return;
    }
    const kept = Array.from(trimReviewState.keptPages).sort((a, b) => a - b);
    if (!kept.length) {
      if (trimModalError) {
        trimModalError.textContent = 'Select at least one page to keep.';
        trimModalError.hidden = false;
        if (trimModalError.dataset) trimModalError.dataset.trimContext = 'selection';
      }
      updateTrimModalApplyState();
      return;
    }

    const file = findViewerFileByDocId(docId) || trimReviewState.file;
    if (!file) {
      if (trimModalError) {
        trimModalError.textContent = 'Document unavailable for trim review.';
        trimModalError.hidden = false;
        if (trimModalError.dataset) trimModalError.dataset.trimContext = 'apply';
      }
      return;
    }

    trimReviewState.isSubmitting = true;
    if (trimModalError) {
      trimModalError.hidden = true;
      trimModalError.textContent = '';
      if (trimModalError.dataset) trimModalError.dataset.trimContext = '';
    }
    const restore = trimModalApply ? withButtonSpinner(trimModalApply, 'Applying…') : () => {};
    if (trimModalCancel) {
      trimModalCancel.disabled = true;
    }

    try {
      const response = await apiFetch('/trim/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId, keptPages: kept }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || 'Unable to apply trim');
      }

      const pageCount = trimReviewState.pageCount || (kept.length ? Math.max(...kept) : null);
      const metaUpdates = {
        pages_kept: kept,
        trim_required: false,
        trim_review_state: 'completed',
      };
      if (pageCount) {
        metaUpdates.page_count_original = pageCount;
      }

      clearTrimWarning(file);
      applyProcessingUpdate(file, {
        meta: metaUpdates,
        ui: { warning: false },
      });
      renderViewerFiles();
      queueRefresh();

      const processResponse = await apiFetch('/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId }),
      });
      const processPayload = await processResponse.json().catch(() => null);
      if (!processResponse.ok || !processPayload?.ok) {
        throw new Error(processPayload?.error || 'Unable to queue processing');
      }

      applyProcessingUpdate(file, {
        status: 'processing',
        processing: {
          provider: 'docupipe',
          stdJobId: processPayload.stdJobId,
          standardizationId: processPayload.standardizationId,
          startedAt: new Date().toISOString(),
        },
      });
      renderViewerFiles();
      queueRefresh();
      startProcessingPoll(docId);
      hideTrimModal();
    } catch (error) {
      console.error('Failed to apply trim selection', error);
      if (trimModalError) {
        trimModalError.textContent = error.message || 'Unable to apply trim right now.';
        trimModalError.hidden = false;
        if (trimModalError.dataset) trimModalError.dataset.trimContext = 'apply';
      }
    } finally {
      trimReviewState.isSubmitting = false;
      restore();
      if (trimModalCancel) {
        trimModalCancel.disabled = false;
      }
    }
  }

  async function deleteViewerFile(fileId) {
    if (!fileId) return;
    const confirmed = window.confirm('Are you sure you want to delete this document? This action cannot be undone.');
    if (!confirmed) return;
    try {
      const response = await apiFetch(`/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
      if (response.status === 401) {
        handleUnauthorised('Please sign in again to delete documents.');
        return;
      }
      if (!response.ok) {
        const text = await safeJson(response);
        throw new Error(text?.error || 'Delete failed');
      }
      state.viewer.files = state.viewer.files.filter((file) => file.fileId !== fileId);
      if (state.viewer.selectedFileId === fileId) {
        state.viewer.selectedFileId = null;
        if (viewerFrame) viewerFrame.src = 'about:blank';
        if (viewerEmpty) {
          viewerEmpty.style.display = '';
          viewerEmpty.textContent = 'Select a file to see the preview and actions.';
        }
      }
      renderViewerFiles();
      queueRefresh();
    } catch (error) {
      console.error('Failed to delete file', error);
      window.alert(error.message || 'Unable to delete file right now.');
    }
  }

  function buildViewerFileCard(file) {
    const card = document.createElement('article');
    card.className = 'viewer__file';
    card.dataset.fileId = file.fileId;
    if (state.viewer.selectedFileId === file.fileId) {
      card.classList.add('is-selected');
    }

    const raw = ensureObject(file.raw);
    file.raw = raw;
    const processing = normaliseProcessingState(file.processingInfo || raw.processing || file.processing || {}, 'idle');
    file.processingInfo = processing;
    file.processingStatus = processing.status;
    file.processing = processing.status;
    const docId = resolveDocId(file);
    if (docId) {
      card.dataset.docId = docId;
    }
    const docClass = resolveDocClass(file);
    const hasWarning = docHasWarning(file);

    const header = document.createElement('div');
    header.className = 'viewer__file-header';
    const titleGroup = document.createElement('div');
    titleGroup.className = 'viewer__file-titles';
    const title = document.createElement('h4');
    title.className = 'viewer__file-title';
    title.textContent = file.title || 'Document';
    titleGroup.appendChild(title);
    if (file.subtitle) {
      const subtitle = document.createElement('span');
      subtitle.className = 'viewer__file-subtitle muted';
      subtitle.textContent = file.subtitle;
      titleGroup.appendChild(subtitle);
    }
    header.appendChild(titleGroup);

    const statusGroup = document.createElement('div');
    statusGroup.className = 'viewer__file-status';
    statusGroup.appendChild(createStatusIndicator('Processing status', processing));
    if (hasWarning) {
      const warningIcon = document.createElement('i');
      warningIcon.className = 'bi bi-exclamation-triangle-fill viewer__file-warning';
      warningIcon.setAttribute('role', 'button');
      warningIcon.setAttribute('aria-label', 'Long document — review trim before processing');
      warningIcon.title = 'Long document — review trim before processing';
      warningIcon.tabIndex = 0;
      warningIcon.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openTrimReview(file, warningIcon);
      });
      warningIcon.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        openTrimReview(file, warningIcon);
      });
      statusGroup.appendChild(warningIcon);
    }
    header.appendChild(statusGroup);
    card.appendChild(header);

    if (Array.isArray(file.summary) && file.summary.length) {
      const meta = document.createElement('div');
      meta.className = 'viewer__file-meta';
      file.summary.forEach((entry) => {
        const block = document.createElement('div');
        const label = document.createElement('strong');
        label.textContent = entry.label;
        const value = document.createElement('span');
        value.textContent = entry.value != null && entry.value !== '' ? entry.value : '—';
        block.append(label, value);
        meta.appendChild(block);
      });
      card.appendChild(meta);
    }

    const actions = document.createElement('div');
    actions.className = 'viewer__file-actions';
    const previewButton = document.createElement('button');
    previewButton.type = 'button';
    previewButton.textContent = 'Preview';
    previewButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      selectViewerFile(file.fileId, { preview: true });
    });
    actions.appendChild(previewButton);

    const canAutoTrim = docClass === 'bank_statement';
    if (canAutoTrim) {
      const autoTrimButton = document.createElement('button');
      autoTrimButton.type = 'button';
      autoTrimButton.textContent = 'Auto-trim';
      if (!docId) {
        autoTrimButton.disabled = true;
        autoTrimButton.title = 'Document identifier unavailable for trimming.';
      }
      autoTrimButton.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!docId) {
          window.alert('Unable to trim this document because it is missing an identifier.');
          return;
        }
        const restore = withButtonSpinner(autoTrimButton, 'Auto-trimming…');
        try {
          await requestAutoTrim(file, docId);
          renderViewerFiles();
          queueRefresh();
        } catch (error) {
          console.error('Auto-trim failed', error);
          window.alert(error.message || 'Unable to auto-trim this document right now.');
        } finally {
          restore();
        }
      });
      actions.appendChild(autoTrimButton);
    }

    if (hasWarning) {
      const reviewTrimButton = document.createElement('button');
      reviewTrimButton.type = 'button';
      reviewTrimButton.textContent = 'Review Trim';
      reviewTrimButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openTrimReview(file, reviewTrimButton);
      });
      actions.appendChild(reviewTrimButton);
    }

    const processableClasses = new Set(['bank_statement', 'payslip']);
    if (processableClasses.has(docClass)) {
      const processButton = document.createElement('button');
      processButton.type = 'button';
      processButton.textContent = processing.status === 'processing' ? 'Processing…' : 'Process';
      if (!docId) {
        processButton.disabled = true;
        processButton.title = 'Document identifier unavailable for processing.';
      }
      if (processing.status === 'processing') {
        processButton.disabled = true;
      }
      processButton.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!docId) {
          window.alert('Unable to process this document because it is missing an identifier.');
          return;
        }
        const restore = withButtonSpinner(processButton, 'Processing…');
        try {
          const response = await apiFetch('/process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ docId }),
          });
          const payload = await response.json().catch(() => null);
          if (!response.ok || !payload?.ok) {
            throw new Error(payload?.error || 'Process failed');
          }
          applyProcessingUpdate(file, {
            status: 'processing',
            processing: {
              stdJobId: payload.stdJobId,
              standardizationId: payload.standardizationId,
              startedAt: new Date().toISOString(),
            },
          });
          renderViewerFiles();
          queueRefresh();
          startProcessingPoll(docId);
        } catch (error) {
          console.error('Processing failed', error);
          window.alert(error.message || 'Unable to process this document right now.');
        } finally {
          restore();
        }
      });
      actions.appendChild(processButton);
    }

    const processedJsonButton = document.createElement('button');
    processedJsonButton.type = 'button';
    processedJsonButton.textContent = 'Processed JSON';
    if (processing.status !== 'completed' || !docId) {
      processedJsonButton.disabled = true;
      processedJsonButton.title = 'Available after processing completes.';
    }
    processedJsonButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      showProcessedJson(file, processedJsonButton);
    });
    actions.appendChild(processedJsonButton);

    const downloadButton = document.createElement('button');
    downloadButton.type = 'button';
    downloadButton.textContent = 'Download';
    downloadButton.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        const response = await authFetch(`${API_BASE}/files/${encodeURIComponent(file.fileId)}/download`);
        if (response.status === 401) {
          handleUnauthorised('Please sign in again to download documents.');
          return;
        }
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new Error(text || 'Download failed');
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        const fallbackName = file.title || file.fileId || 'document';
        anchor.download = `${fallbackName.replace(/[^\w. -]+/g, '_')}.pdf`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
      } catch (error) {
        console.error('Failed to download document', error);
        window.alert(error.message || 'Unable to download this document right now.');
      }
    });
    actions.appendChild(downloadButton);

    if (jsonTestEnabled && (!docId || processing.status !== 'completed')) {
      const debugJsonButton = document.createElement('button');
      debugJsonButton.type = 'button';
      debugJsonButton.textContent = 'Debug JSON';
      debugJsonButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        showJsonForFile(file, debugJsonButton);
      });
      actions.appendChild(debugJsonButton);
    }

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', (event) => {
      event.stopPropagation();
      deleteViewerFile(file.fileId);
    });
    actions.appendChild(deleteButton);
    card.appendChild(actions);

    const uiMessages = Array.isArray(raw.ui?.messages) ? raw.ui.messages.filter((msg) => typeof msg === 'string' && msg.trim()) : [];
    if (uiMessages.length) {
      const messageBox = document.createElement('div');
      messageBox.className = 'viewer__file-messages';
      uiMessages.forEach((msg) => {
        const line = document.createElement('p');
        line.textContent = msg;
        messageBox.appendChild(line);
      });
      card.appendChild(messageBox);
    }

    const details = document.createElement('div');
    details.className = 'viewer__file-details';
    if (Array.isArray(file.details) && file.details.length) {
      file.details.forEach((entry) => {
        const block = document.createElement('div');
        const label = document.createElement('strong');
        label.textContent = entry.label;
        const value = document.createElement('span');
        value.textContent = entry.value != null && entry.value !== '' ? entry.value : '—';
        block.append(label, value);
        details.appendChild(block);
      });
    }
    if (file.isExpanded) {
      details.classList.add('is-expanded');
    }
    card.appendChild(details);

    card.addEventListener('click', () => {
      file.isExpanded = !file.isExpanded;
      details.classList.toggle('is-expanded', file.isExpanded);
      selectViewerFile(file.fileId, { preview: false });
    });

    return card;
  }

  function renderViewerFiles() {
    if (!viewerList) return;
    viewerList.innerHTML = '';
    const files = Array.isArray(state.viewer.files) ? state.viewer.files : [];
    if (!files.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'No documents available yet.';
      viewerList.appendChild(empty);
      if (viewerEmpty) {
        viewerEmpty.style.display = '';
        viewerEmpty.textContent = 'Upload a document to see it here.';
      }
      return;
    }
    files.forEach((file) => {
      viewerList.appendChild(buildViewerFileCard(file));
    });
    renderViewerSelection();
    if (viewerEmpty) {
      viewerEmpty.style.display = state.viewer.selectedFileId ? 'none' : '';
      if (!state.viewer.selectedFileId) {
        viewerEmpty.textContent = 'Select a file to see the preview and actions.';
      }
    }
  }

  function showViewer({ type, title, subtitle, files }) {
    if (!viewerRoot) return;
    state.viewer.type = type;
    state.viewer.context = { title, subtitle };
    state.viewer.files = Array.isArray(files) ? files : [];
    state.viewer.selectedFileId = null;
    viewerRoot.setAttribute('aria-hidden', 'false');
    if (viewerTitle) viewerTitle.textContent = title || 'Documents';
    if (viewerSubtitle) viewerSubtitle.textContent = subtitle || '';
    renderViewerFiles();
  }

  function persistState() {
    if (typeof localStorage === 'undefined') return;
    try {
      const payload = {
        sessions: Array.from(state.sessions.entries()).map(([sessionId, session]) => ({
          sessionId,
          files: Array.from(session.files.values()).map((file) => ({
            fileId: file.fileId,
            originalName: file.originalName,
            upload: file.upload,
            processing: file.processing,
            state: file.state,
            classification: file.classification || null,
            message: file.message || '',
          })),
          rejected: Array.isArray(session.rejected)
            ? session.rejected.map((entry) => ({ originalName: entry.originalName, reason: entry.reason }))
            : [],
        })),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.warn('Failed to persist vault sessions', error);
    }
  }

  function restoreSessionsFromStorage() {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.sessions)) return;
      data.sessions.forEach((entry) => {
        if (!entry || !entry.sessionId) return;
        const session = upsertSession(entry.sessionId);
        session.rejected = Array.isArray(entry.rejected)
          ? entry.rejected.map((item) => ({ originalName: item.originalName, reason: item.reason }))
          : [];
        if (Array.isArray(entry.files)) {
          entry.files.forEach((file) => {
            if (!file || !file.fileId) return;
            const record = normaliseFileRecord(entry.sessionId, {
              fileId: file.fileId,
              originalName: file.originalName,
              upload: file.upload || 'queued',
              processing: file.processing || file.state || 'queued',
              state: file.state || file.processing || 'queued',
              classification: file.classification || null,
              message: file.message || '',
            });
            session.files.set(file.fileId, record);
          });
        }
      });
      renderSessionPanel();
      queueStatusPolling();
    } catch (error) {
      console.warn('Failed to restore vault sessions', error);
    }
  }

  function beginPlaceholder({ phase }) {
    if (!phase) return null;
    const id = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : `placeholder-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    state.placeholders.set(id, { phase, total: 1, completed: 0 });
    updateProgressUI();
    return id;
  }

  function completePlaceholder(id) {
    if (!id) return;
    const placeholder = state.placeholders.get(id);
    if (placeholder) {
      placeholder.completed = placeholder.total || 1;
    }
    state.placeholders.delete(id);
    updateProgressUI();
  }

  function stopPolling() {
    if (state.timers.uploads) {
      clearInterval(state.timers.uploads);
      state.timers.uploads = null;
    }
    if (state.timers.tiles) {
      clearInterval(state.timers.tiles);
      state.timers.tiles = null;
    }
    if (state.timers.lists) {
      clearInterval(state.timers.lists);
      state.timers.lists = null;
    }
  }

  function handleUnauthorised(message) {
    if (unauthorised) return;
    unauthorised = true;
    stopPolling();
    showError(message || 'Your session has expired. Please sign in again.');
    if (window.Auth && typeof Auth.enforce === 'function') {
      Auth.enforce({ validateWithServer: true }).catch(() => {});
    }
  }

  async function apiFetch(path, options) {
    const response = await authFetch(`${API_BASE}${path}`, options);
    if (response.status === 401) {
      handleUnauthorised('Your session has expired. Please sign in again.');
    }
    return response;
  }

  function animateOnce(element, className, { duration = 420 } = {}) {
    return new Promise((resolve) => {
      if (!element) return resolve();

      const cleanup = () => {
        element.removeEventListener('animationend', onEnd);
        element.removeEventListener('transitionend', onEnd);
        element.classList.remove(className);
        clearTimeout(timer);
        resolve();
      };

      const onEnd = (event) => {
        if (event.target !== element) return;
        cleanup();
      };

      const timer = setTimeout(cleanup, duration);
      element.addEventListener('animationend', onEnd);
      element.addEventListener('transitionend', onEnd);
      element.classList.add(className);
    });
  }

  function renderSessionPanel() {
    if (!(sessionRows && sessionEmpty)) return;
    sessionRows.innerHTML = '';
    let rowCount = 0;
    for (const session of state.sessions.values()) {
      for (const file of session.files.values()) {
        rowCount += 1;
        sessionRows.appendChild(renderFileRow(file));
      }
      for (const rejected of session.rejected) {
        rowCount += 1;
        sessionRows.appendChild(renderRejectedRow(rejected));
      }
    }
    if (rowCount === 0) {
      sessionEmpty.style.display = '';
    } else {
      sessionEmpty.style.display = 'none';
    }
    updateProgressUI();
    persistState();
  }

  function renderFileRow(file) {
    const row = document.createElement('div');
    row.className = 'session-row';
    if (file.state) {
      row.dataset.state = file.state;
      if (file.state === 'needs_trim' || file.state === 'awaiting_manual_json' || file.state === 'failed') {
        row.classList.add('session-row--attention');
      }
    }
    const name = document.createElement('div');
    name.className = 'filename';
    name.textContent = file.originalName;
    row.appendChild(name);

    const uploadIndicator = createStatusIndicator('Upload', file.upload || 'completed');
    const processingIndicator = createStatusIndicator('Processing', file.processing || 'queued');

    const indicators = document.createElement('div');
    indicators.className = 'status-list';
    indicators.append(uploadIndicator, processingIndicator);
    row.appendChild(indicators);

    const message = document.createElement('div');
    message.className = 'message muted';
    const classificationLabel = file.classification?.label || file.classification?.key || '';
    const parts = [];
    if (classificationLabel) parts.push(classificationLabel);
    if (file.message) parts.push(file.message);
    message.textContent = parts.join(' • ');
    row.appendChild(message);
    return row;
  }

  function renderRejectedRow(entry) {
    const row = document.createElement('div');
    row.className = 'session-row';
    const name = document.createElement('div');
    name.className = 'filename';
    name.textContent = entry.originalName;
    row.appendChild(name);

    const indicators = document.createElement('div');
    indicators.className = 'status-list';
    indicators.appendChild(createStatusIndicator('Upload', 'queued'));
    indicators.appendChild(createStatusIndicator('Processing', 'queued'));
    row.appendChild(indicators);

    const message = document.createElement('div');
    message.className = 'message muted';
    message.textContent = entry.reason || 'Rejected';
    row.appendChild(message);
    return row;
  }

  // createStatusIndicator defined earlier

  function normaliseFileRecord(sessionId, file) {
    const record = state.files.get(file.fileId) || {
      sessionId,
      fileId: file.fileId,
      upload: 'queued',
      processing: 'queued',
      message: '',
      state: 'queued',
    };
    if (file.originalName) {
      record.originalName = file.originalName;
    }
    if (file.upload) {
      record.upload = normaliseStatus(file.upload, 'completed');
    } else if (!record.upload) {
      record.upload = 'queued';
    }
    if (file.state) {
      record.state = String(file.state);
      record.processing = normaliseStatus(file.state, 'queued');
    } else if (file.processing) {
      record.processing = normaliseStatus(file.processing, 'queued');
    } else if (!record.processing) {
      record.processing = 'queued';
    }
    if (file.classification) {
      record.classification = file.classification;
    }
    if (file.message != null) {
      record.message = file.message;
    } else if (record.message == null) {
      record.message = '';
    }
    if (!record.message) {
      if (record.state === 'needs_trim') {
        record.message = 'Manual trim required before processing.';
      } else if (record.state === 'awaiting_manual_json') {
        record.message = 'Manual JSON input required before processing.';
      }
    }
    state.files.set(file.fileId, record);
    return record;
  }

  function upsertSession(sessionId) {
    if (!state.sessions.has(sessionId)) {
      state.sessions.set(sessionId, { files: new Map(), rejected: [] });
    }
    return state.sessions.get(sessionId);
  }

  function handleUploadResponse(payload) {
    if (!payload) return;
    const sessionId = payload.sessionId
      || ((typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        : `session-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const session = upsertSession(sessionId);
    if (Array.isArray(payload.files)) {
      payload.files.forEach((file) => {
        if (!file.fileId) return;
        const initialState = file.state || file.processing || 'queued';
        const record = normaliseFileRecord(sessionId, {
          ...file,
          upload: 'completed',
          processing: initialState,
          state: initialState,
        });
        session.files.set(file.fileId, record);
      });
    }
    if (Array.isArray(payload.rejected)) {
      payload.rejected.forEach((entry) => {
        session.rejected.push({ originalName: entry.originalName, reason: entry.reason });
      });
    }
    renderSessionPanel();
    queueStatusPolling();
    queueRefresh();
  }

  function showError(message) {
    sessionRows.innerHTML = '';
    sessionEmpty.style.display = '';
    sessionEmpty.textContent = message;
    hideProgress();
  }

  async function uploadFile(file, { placeholderId } = {}) {
    const formData = new FormData();
    formData.append('file', file, file.name);
    if (state.selectedCollectionId) {
      formData.append('collectionId', state.selectedCollectionId);
    }
    try {
      if (window.Auth && typeof Auth.requireAuth === 'function') {
        await Auth.requireAuth();
      }
      const response = await apiFetch('/upload', { method: 'POST', body: formData });
      if (!response.ok) {
        const text = await safeJson(response);
        const errorMessage = response.status === 401 ? 'Your session has expired. Please sign in again.' : (text?.error || 'Upload failed');
        throw new Error(errorMessage);
      }
      const json = await response.json();
      handleUploadResponse(json);
    } catch (error) {
      console.error('Upload error', error);
      if (error.message && error.message.toLowerCase().includes('sign in')) {
        handleUnauthorised(error.message);
      } else {
        showError(error.message || 'Upload failed');
      }
    } finally {
      completePlaceholder(placeholderId);
    }
  }

  function handleFiles(fileList) {
    if (!fileList || !fileList.length) return;
    Array.from(fileList).forEach((file) => {
      const ext = (file.name || '').toLowerCase();
      if (!(ext.endsWith('.pdf') || ext.endsWith('.zip'))) {
        showError('We only accept PDF or ZIP uploads.');
        return;
      }
      const phase = ext.endsWith('.zip') ? 'Extracting zip' : 'Uploading files';
      const placeholderId = beginPlaceholder({ phase });
      uploadFile(file, { placeholderId });
    });
    fileInput.value = '';
  }

  function setupDropzone() {
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        fileInput.click();
      }
    });
    dropzone.addEventListener('dragover', (event) => {
      event.preventDefault();
      dropzone.classList.add('drag-active');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-active'));
    dropzone.addEventListener('drop', (event) => {
      event.preventDefault();
      dropzone.classList.remove('drag-active');
      handleFiles(event.dataTransfer.files);
    });
    fileInput.addEventListener('change', () => handleFiles(fileInput.files));
  }

  async function pollFileStatus(fileId) {
    try {
      const response = await apiFetch(`/files/${encodeURIComponent(fileId)}/status`);
      if (response.status === 404) {
        const record = state.files.get(fileId);
        if (record) {
          state.files.delete(fileId);
          const session = state.sessions.get(record.sessionId);
          if (session) {
            session.files.delete(fileId);
            if (session.files.size === 0 && session.rejected.length === 0) {
              state.sessions.delete(record.sessionId);
            }
          }
          renderSessionPanel();
        }
        return;
      }
      if (!response.ok) return;
      const data = await response.json();
      const record = state.files.get(fileId);
      if (!record) return;
      const previousProcessing = normaliseStatus(record.processing, 'queued');
      record.upload = normaliseStatus(data.upload || record.upload, 'completed');
      if (data.state) {
        record.state = String(data.state);
        record.processing = normaliseStatus(data.state, 'queued');
      } else if (data.processing) {
        record.processing = normaliseStatus(data.processing, 'queued');
      }
      if (data.classification) {
        record.classification = data.classification;
      }
      const serverMessage = typeof data.message === 'string' ? data.message : '';
      if (serverMessage) {
        record.message = serverMessage;
      } else if (record.state === 'needs_trim') {
        record.message = 'Manual trim required before processing.';
      } else if (record.state === 'awaiting_manual_json') {
        record.message = 'Manual JSON input required before processing.';
      } else if (!record.message) {
        record.message = '';
      }
      const session = state.sessions.get(record.sessionId);
      if (session) {
        session.files.set(fileId, record);
      }
      renderSessionPanel();
      if (previousProcessing !== 'completed' && record.processing === 'completed') {
        queueRefresh();
      }
    } catch (error) {
      console.warn('Status poll failed', error);
    }
  }

  function queueStatusPolling() {
    if (state.timers.uploads) return;
    state.timers.uploads = setInterval(() => {
      for (const fileId of state.files.keys()) {
        pollFileStatus(fileId);
      }
    }, POLL_INTERVAL_UPLOAD);
  }

  async function fetchFeatureFlags() {
    try {
      const response = await authFetch('/api/flags', { cache: 'no-store' });
      if (response.status === 401) {
        handleUnauthorised('Please sign in again to continue.');
        return;
      }
      if (!response.ok) return;
      const flags = await response.json().catch(() => null);
      jsonTestEnabled = Boolean(flags?.JSON_TEST_ENABLED);
    } catch (error) {
      console.warn('Failed to load feature flags', error);
    }
  }

  async function fetchTiles() {
    try {
      const response = await apiFetch('/tiles');
      if (!response.ok) return;
      const data = await response.json();
      renderTiles(data);
    } catch (error) {
      console.warn('Tile fetch failed', error);
    }
  }

  function renderTiles(data) {
    const tiles = [];
    const raw = data?.tiles || {};
    tiles.push({
      id: 'payslips',
      label: 'Payslips',
      count: raw.payslips?.count || 0,
      updated: raw.payslips?.lastUpdated || null,
    });
    tiles.push({
      id: 'statements',
      label: 'Statements',
      count: (raw.statements?.count || 0) + (raw.savings?.count || 0),
      updated: raw.statements?.lastUpdated || raw.savings?.lastUpdated || null,
    });
    tiles.push({
      id: 'savings-isa',
      label: 'Savings & ISA',
      count: (raw.savings?.count || 0) + (raw.isa?.count || 0),
      updated: raw.isa?.lastUpdated || raw.savings?.lastUpdated || null,
    });
    tiles.push({
      id: 'investments',
      label: 'Investments',
      count: raw.investments?.count || 0,
      updated: raw.investments?.lastUpdated || null,
    });
    tiles.push({
      id: 'pensions',
      label: 'Pensions',
      count: raw.pension?.count || 0,
      updated: raw.pension?.lastUpdated || null,
    });
    tiles.push({
      id: 'hmrc',
      label: 'HMRC',
      count: raw.hmrc?.count || 0,
      updated: raw.hmrc?.lastUpdated || null,
    });

    tilesGrid.innerHTML = '';

    tiles.forEach((tile) => {
      const card = document.createElement('article');
      card.className = 'tile';
      card.dataset.tileId = tile.id;
      card.dataset.tileCount = String(tile.count ?? 0);

      const isInteractive = tile.id === 'payslips' || tile.id === 'statements';
      if (isInteractive) {
        card.classList.add('tile--interactive');
        card.setAttribute('role', 'button');
        card.setAttribute('aria-label', `View ${tile.label} documents`);
        card.tabIndex = 0;
        const handleOpen = (event) => {
          if (event) {
            event.preventDefault();
            event.stopPropagation();
          }
          if (card.classList.contains('tile-is-busy')) return;
          handleTileOpen(tile, card);
        };
        card.addEventListener('click', handleOpen);
        card.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            handleOpen(event);
          }
        });
      }

      const header = document.createElement('div');
      header.className = 'tile-header';

      const labelGroup = document.createElement('div');
      labelGroup.className = 'tile-label';

      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = tile.label;

      const count = document.createElement('strong');
      count.textContent = tile.count.toLocaleString();
      labelGroup.append(label, count);

      const actions = document.createElement('div');
      actions.className = 'tile-actions';

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'tile-delete-btn btn-icon';
      deleteButton.innerHTML = '<i class="bi bi-trash"></i>';
      deleteButton.setAttribute('aria-label', `Delete all ${tile.label} documents`);
      deleteButton.title = tile.count
        ? `Delete all ${tile.label} documents`
        : `No ${tile.label.toLowerCase()} documents to delete`;
      deleteButton.disabled = tile.count === 0;
      deleteButton.addEventListener('click', (event) => {
        event.stopPropagation();
        handleTileDelete(tile, card, deleteButton);
      });
      actions.appendChild(deleteButton);

      header.append(labelGroup, actions);
      card.appendChild(header);

      if (tile.updated) {
        const updated = document.createElement('span');
        updated.className = 'muted tile-updated';
        updated.textContent = `Updated ${new Date(tile.updated).toLocaleString()}`;
        card.appendChild(updated);
      }

      tilesGrid.appendChild(card);
    });

    if ((data?.processing || 0) > 0) {
      const pill = document.createElement('div');
      pill.className = 'processing-pill';
      pill.textContent = `${data.processing} processing…`;
      tilesGrid.prepend(pill);
    }
  }

  function withTileLoading(card, label = 'Loading…') {
    if (!card) return () => {};
    let overlay = card.querySelector('.tile-loading');
    if (overlay) {
      overlay.remove();
    }
    overlay = document.createElement('div');
    overlay.className = 'tile-loading';
    overlay.innerHTML = `
      <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
      <span>${label}</span>
    `;
    card.appendChild(overlay);
    card.classList.add('tile-is-busy');
    card.setAttribute('aria-busy', 'true');
    return () => {
      card.classList.remove('tile-is-busy');
      card.removeAttribute('aria-busy');
      if (overlay && overlay.isConnected) {
        overlay.remove();
      }
    };
  }

  async function handleTileOpen(tile, card) {
    if (!tile || !card) return;
    const cleanup = withTileLoading(card);
    try {
      if (tile.id === 'payslips') {
        await openPayslipTile();
      } else if (tile.id === 'statements') {
        await openStatementTile();
      }
    } catch (error) {
      console.error('Tile open failed', error);
      window.alert(error.message || `Unable to load ${tile.label || 'documents'} right now.`);
    } finally {
      cleanup();
    }
  }

  async function openPayslipTile() {
    const response = await apiFetch('/payslips/employers');
    if (response.status === 401) {
      handleUnauthorised('Please sign in again to view your payslips.');
      return;
    }
    if (!response.ok) {
      const payload = await safeJson(response);
      throw new Error(payload?.error || 'Unable to load payslips.');
    }

    const data = await response.json();
    const employers = Array.isArray(data?.employers) ? data.employers : [];
    if (!employers.length) {
      showViewer({ type: 'payslip', title: 'Payslips', subtitle: 'No documents yet', files: [] });
      return;
    }

    const files = [];
    for (const employer of employers) {
      const employerId = employer?.employerId;
      if (!employerId) continue;
      const detailResponse = await apiFetch(`/payslips/employers/${encodeURIComponent(employerId)}/files`);
      if (detailResponse.status === 401) {
        handleUnauthorised('Please sign in again to view your payslips.');
        return;
      }
      if (!detailResponse.ok) {
        const payload = await safeJson(detailResponse);
        const name = employer?.name || 'employer';
        throw new Error(payload?.error || `Unable to load payslips for ${name}.`);
      }
      const detailData = await detailResponse.json();
      const employerName = employer?.name || detailData?.employer || 'Employer';
      const viewerFiles = normalisePayslipViewerFiles(detailData?.files, {
        employerName,
        includeEmployerInSummary: true,
      });
      files.push(...viewerFiles);
    }

    const subtitleParts = [];
    if (files.length) {
      subtitleParts.push(`${files.length} document${files.length === 1 ? '' : 's'}`);
    }
    subtitleParts.push(`${employers.length} employer${employers.length === 1 ? '' : 's'}`);

    const subtitle = files.length ? subtitleParts.join(' · ') : 'No documents yet';
    showViewer({
      type: 'payslip',
      title: 'Payslips',
      subtitle,
      files,
    });
  }

  async function openStatementTile() {
    const response = await apiFetch('/statements/institutions');
    if (response.status === 401) {
      handleUnauthorised('Please sign in again to view your statements.');
      return;
    }
    if (!response.ok) {
      const payload = await safeJson(response);
      throw new Error(payload?.error || 'Unable to load statements.');
    }

    const data = await response.json();
    const institutions = Array.isArray(data?.institutions) ? data.institutions : [];
    if (!institutions.length) {
      showViewer({ type: 'statement', title: 'Statements', subtitle: 'No documents yet', files: [] });
      return;
    }

    const files = [];
    let totalAccounts = 0;
    for (const institution of institutions) {
      const institutionId = institution?.institutionId;
      if (!institutionId) continue;
      const detailResponse = await apiFetch(`/statements/institutions/${encodeURIComponent(institutionId)}/files`);
      if (detailResponse.status === 401) {
        handleUnauthorised('Please sign in again to view your statements.');
        return;
      }
      if (!detailResponse.ok) {
        const payload = await safeJson(detailResponse);
        const name = institution?.name || 'institution';
        throw new Error(payload?.error || `Unable to load statements for ${name}.`);
      }
      const detailData = await detailResponse.json();
      const accounts = Array.isArray(detailData?.accounts) ? detailData.accounts : [];
      totalAccounts += accounts.length;
      const institutionName = normaliseStatementName(institution?.name || detailData?.institution?.name);
      const viewerFiles = normaliseStatementViewerFiles(accounts, {
        institutionName,
        includeInstitutionInSummary: true,
      });
      files.push(...viewerFiles);
    }

    const subtitleParts = [];
    if (files.length) {
      subtitleParts.push(`${files.length} document${files.length === 1 ? '' : 's'}`);
    }
    if (totalAccounts) {
      subtitleParts.push(`${totalAccounts} account${totalAccounts === 1 ? '' : 's'}`);
    }
    subtitleParts.push(`${institutions.length} institution${institutions.length === 1 ? '' : 's'}`);

    const subtitle = files.length ? subtitleParts.join(' · ') : 'No documents yet';
    showViewer({
      type: 'statement',
      title: 'Statements',
      subtitle,
      files,
    });
  }

  async function handleTileDelete(tile, card, button) {
    if (!tile || !card || !button || button.disabled) return;
    if (tile.count === 0) return;

    const countLabel = tile.count === 1 ? '1 document' : `${tile.count.toLocaleString()} documents`;
    const confirmed = window.confirm(
      `Delete ${countLabel} from ${tile.label}? This will permanently remove the files from your vault and Cloudflare R2.`
    );
    if (!confirmed) return;

    const originalContent = button.innerHTML;
    button.disabled = true;
    button.classList.add('is-loading');
    button.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';
    card.classList.add('tile-is-busy');

    try {
      const response = await apiFetch(`/tiles/${encodeURIComponent(tile.id)}`, { method: 'DELETE' });
      if (!response.ok) {
        const payload = await safeJson(response);
        throw new Error(payload?.error || 'Failed to delete documents');
      }
      await animateOnce(card, 'tile--cleared', { duration: 520 });
      await Promise.all([fetchTiles(), fetchPayslips(), fetchStatements(), fetchCollections()]);
    } catch (error) {
      console.error('Tile delete failed', error);
      alert(error.message || 'Failed to delete documents');
    } finally {
      if (button.isConnected) {
        button.classList.remove('is-loading');
        button.innerHTML = originalContent;
        button.disabled = false;
      }
      card.classList.remove('tile-is-busy');
    }
  }

  async function fetchPayslips() {
    try {
      const response = await apiFetch('/payslips/employers');
      if (!response.ok) return;
      const data = await response.json();
      renderEmployerGrid(data?.employers || []);
    } catch (error) {
      console.warn('Payslip fetch failed', error);
    }
  }

  async function openPayslipViewer(employer) {
    if (!employer?.employerId) return;
    try {
      const response = await apiFetch(`/payslips/employers/${encodeURIComponent(employer.employerId)}/files`);
      if (response.status === 401) {
        handleUnauthorised('Please sign in again to view your payslips.');
        return;
      }
      if (!response.ok) {
        const text = await safeJson(response);
        throw new Error(text?.error || 'Unable to load payslips');
      }
      const data = await response.json();
      const employerName = employer.name || data?.employer || 'Employer';
      const files = normalisePayslipViewerFiles(data?.files, { employerName, includeEmployerInSummary: false });
      showViewer({
        type: 'payslip',
        title: employerName,
        subtitle: files.length ? `${files.length} document${files.length === 1 ? '' : 's'}` : 'No documents yet',
        files,
      });
    } catch (error) {
      console.error('Failed to open payslip viewer', error);
      window.alert(error.message || 'Unable to load payslip documents right now.');
    }
  }

  function renderEmployerGrid(employers) {
    payslipGrid.innerHTML = '';
    payslipMeta.textContent = employers.length ? `${employers.length} employer${employers.length === 1 ? '' : 's'}` : 'No payslips yet.';
    employers.forEach((employer) => {
      const card = document.createElement('article');
      applyEntityBranding(card, employer.name);
      const title = document.createElement('h3');
      title.textContent = employer.name || 'Unknown employer';
      const dl = document.createElement('dl');
      dl.innerHTML = `
        <div><span>Files</span><span>${employer.count}</span></div>
        <div><span>Last pay date</span><span>${employer.lastPayDate ? new Date(employer.lastPayDate).toLocaleDateString() : '—'}</span></div>
      `;
      card.append(title, dl);
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `View payslips for ${employer.name || 'employer'}`);
      const open = () => openPayslipViewer(employer);
      card.addEventListener('click', open);
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      });
      payslipGrid.appendChild(card);
    });
  }

  async function fetchStatements() {
    try {
      const response = await apiFetch('/statements/institutions');
      if (!response.ok) return;
      const data = await response.json();
      renderInstitutionGrid(data?.institutions || []);
    } catch (error) {
      console.warn('Statements fetch failed', error);
    }
  }

  async function openStatementViewer(institution) {
    if (!institution?.institutionId) return;
    try {
      const response = await apiFetch(`/statements/institutions/${encodeURIComponent(institution.institutionId)}/files`);
      if (response.status === 401) {
        handleUnauthorised('Please sign in again to view your statements.');
        return;
      }
      if (!response.ok) {
        const text = await safeJson(response);
        throw new Error(text?.error || 'Unable to load statements');
      }
      const data = await response.json();
      const accounts = Array.isArray(data?.accounts) ? data.accounts : [];
      const institutionName = normaliseStatementName(institution.name || data?.institution?.name);
      const files = normaliseStatementViewerFiles(accounts, {
        institutionName,
        includeInstitutionInSummary: false,
      });
      showViewer({
        type: 'statement',
        title: institutionName,
        subtitle: files.length ? `${files.length} document${files.length === 1 ? '' : 's'}` : 'No documents yet',
        files,
      });
    } catch (error) {
      console.error('Failed to open statements viewer', error);
      window.alert(error.message || 'Unable to load statement documents right now.');
    }
  }

  function renderInstitutionGrid(institutions) {
    statementGrid.innerHTML = '';
    statementMeta.textContent = institutions.length ? `${institutions.length} institution${institutions.length === 1 ? '' : 's'}` : 'No statements yet.';
    institutions.forEach((inst) => {
      const card = document.createElement('article');
      const cleanName = normaliseStatementName(inst.name);
      applyEntityBranding(card, cleanName);
      const title = document.createElement('h3');
      title.textContent = cleanName || 'Institution';
      const dl = document.createElement('dl');
      dl.innerHTML = `
        <div><span>Accounts</span><span>${inst.accounts || 0}</span></div>
      `;
      card.append(title, dl);
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `View statements for ${cleanName || 'institution'}`);
      const open = () => openStatementViewer(inst);
      card.addEventListener('click', open);
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      });
      statementGrid.appendChild(card);
    });
  }

  async function fetchCollections() {
    try {
      const response = await apiFetch('/collections');
      if (!response.ok) return;
      const data = await response.json();
      renderCollections(data?.collections || []);
    } catch (error) {
      console.warn('Collections fetch failed', error);
    }
  }

  async function promptCollectionCreate() {
    const name = window.prompt('Name your new collection');
    if (!name || !name.trim()) return;
    try {
      const response = await apiFetch('/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (response.status === 401) {
        handleUnauthorised('Please sign in again to create a collection.');
        return;
      }
      if (!response.ok) {
        const text = await safeJson(response);
        throw new Error(text?.error || 'Create failed');
      }
      const json = await response.json().catch(() => ({}));
      const newId = json?.collection?.id || null;
      await fetchCollections();
      if (newId) {
        state.selectedCollectionId = newId;
        renderCollectionSelection();
        updateCollectionTargetHint();
      }
    } catch (error) {
      console.error('Failed to create collection', error);
      window.alert(error.message || 'Unable to create the collection right now.');
    }
  }

  async function promptCollectionRename(collection) {
    if (!collection?.id) return;
    const name = window.prompt('Rename collection', collection.name || 'Collection');
    if (!name || !name.trim() || name.trim() === collection.name) return;
    try {
      const response = await apiFetch(`/collections/${encodeURIComponent(collection.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (response.status === 401) {
        handleUnauthorised('Please sign in again to rename collections.');
        return;
      }
      if (!response.ok) {
        const text = await safeJson(response);
        throw new Error(text?.error || 'Rename failed');
      }
      await fetchCollections();
    } catch (error) {
      console.error('Failed to rename collection', error);
      window.alert(error.message || 'Unable to rename this collection right now.');
    }
  }

  async function deleteCollection(collection) {
    if (!collection?.id) return;
    const confirmed = window.confirm('Are you sure you want to delete this collection and all contained files? This action is irreversible.');
    if (!confirmed) return;
    try {
      const response = await apiFetch(`/collections/${encodeURIComponent(collection.id)}`, { method: 'DELETE' });
      if (response.status === 401) {
        handleUnauthorised('Please sign in again to delete collections.');
        return;
      }
      if (!response.ok) {
        const text = await safeJson(response);
        throw new Error(text?.error || 'Delete failed');
      }
      if (state.selectedCollectionId === collection.id) {
        state.selectedCollectionId = null;
      }
      await fetchCollections();
      updateCollectionTargetHint();
    } catch (error) {
      console.error('Failed to delete collection', error);
      window.alert(error.message || 'Unable to delete this collection right now.');
    }
  }

  async function downloadCollection(collection) {
    if (!collection?.id) return;
    try {
      const response = await apiFetch(`/collections/${encodeURIComponent(collection.id)}/archive`);
      if (response.status === 401) {
        handleUnauthorised('Please sign in again to download collections.');
        return;
      }
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(text || 'Download failed');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${(collection.name || 'collection').replace(/[^\w. -]+/g, '_')}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (error) {
      console.error('Failed to download collection', error);
      window.alert(error.message || 'Unable to download this collection right now.');
    }
  }

  function selectCollection(collectionId) {
    state.selectedCollectionId = state.selectedCollectionId === collectionId ? null : collectionId;
    renderCollectionSelection();
    updateCollectionTargetHint();
  }

  function renderCollectionSelection() {
    if (!collectionGrid) return;
    const cards = collectionGrid.querySelectorAll('.collection-card');
    cards.forEach((card) => {
      const id = card.dataset.collectionId || null;
      card.classList.toggle('is-selected', id && id === state.selectedCollectionId);
    });
  }

  function buildCollectionCard(collection) {
    const card = document.createElement('article');
    card.className = 'collection-card';
    card.dataset.collectionId = collection.id;
    if (state.selectedCollectionId === collection.id) {
      card.classList.add('is-selected');
    }
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Select collection ${collection.name || 'collection'}`);

    const title = document.createElement('h3');
    title.className = 'collection-card__title';
    title.textContent = collection.name || 'Collection';

    const meta = document.createElement('div');
    meta.className = 'collection-card__meta';
    meta.innerHTML = `
      <span>${formatNumber(collection.fileCount || 0)} file${collection.fileCount === 1 ? '' : 's'}</span>
      <span>${collection.lastUpdated ? `Updated ${formatDate(collection.lastUpdated)}` : 'No recent uploads'}</span>
    `;

    const actions = document.createElement('div');
    actions.className = 'collection-actions';

    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.textContent = 'Rename';
    renameBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      promptCollectionRename(collection);
    });

    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.textContent = 'Download';
    downloadBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      downloadCollection(collection);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      deleteCollection(collection);
    });

    actions.append(renameBtn, downloadBtn, deleteBtn);

    card.append(title, meta, actions);

    const select = () => selectCollection(collection.id);
    card.addEventListener('click', select);
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        select();
      }
    });

    return card;
  }

  function renderCollections(collections) {
    state.collections = Array.isArray(collections) ? collections : [];
    if (state.selectedCollectionId && !state.collections.some((collection) => collection.id === state.selectedCollectionId)) {
      state.selectedCollectionId = null;
    }
    if (collectionGrid) {
      collectionGrid.innerHTML = '';
      const createCard = document.createElement('button');
      createCard.type = 'button';
      createCard.className = 'collection-card collection-card__create';
      createCard.innerHTML = '<span>+ New collection</span>';
      createCard.addEventListener('click', (event) => {
        event.stopPropagation();
        promptCollectionCreate();
      });
      collectionGrid.appendChild(createCard);
      state.collections.forEach((collection) => {
        collectionGrid.appendChild(buildCollectionCard(collection));
      });
      renderCollectionSelection();
    }
    collectionMeta.textContent = state.collections.length
      ? `${state.collections.length} collection${state.collections.length === 1 ? '' : 's'}`
      : 'No collections yet.';
    updateCollectionTargetHint();
  }

  function queueRefresh() {
    if (!state.timers.tiles) {
      fetchTiles();
      state.timers.tiles = setInterval(fetchTiles, POLL_INTERVAL_TILES);
    }
    if (!state.timers.lists) {
      fetchPayslips();
      fetchStatements();
      fetchCollections();
      state.timers.lists = setInterval(() => {
        fetchPayslips();
        fetchStatements();
        fetchCollections();
      }, POLL_INTERVAL_LISTS);
    }
  }

  async function safeJson(response) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  async function init() {
    if (window.Auth && typeof Auth.requireAuth === 'function') {
      try {
        await Auth.requireAuth();
      } catch (error) {
        console.warn('Auth required for vault page', error);
        handleUnauthorised('Please sign in to access your vault.');
        return;
      }
    }

    setupDropzone();
    await fetchFeatureFlags();
    restoreSessionsFromStorage();
    queueRefresh();
    fetchTiles();
    fetchPayslips();
    fetchStatements();
    fetchCollections();
  }

  if (viewerClose) {
    viewerClose.addEventListener('click', () => {
      closeViewer();
    });
  }
  if (viewerOverlay) {
    viewerOverlay.addEventListener('click', () => {
      closeViewer();
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (trimModal && trimModal.classList.contains('is-visible')) {
      event.preventDefault();
      hideTrimModal();
      return;
    }
    if (jsonModal && jsonModal.classList.contains('is-visible')) {
      hideJsonModal();
      return;
    }
    if (viewerRoot && viewerRoot.getAttribute('aria-hidden') === 'false') {
      closeViewer();
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    init().catch((error) => {
      console.error('Failed to initialise vault page', error);
      showError('Something went wrong initialising the vault. Please try again.');
    });
  });
})();
