// frontend/js/vault.js
(function () {
  const API_BASE = '/api/vault';
  const POLL_INTERVAL_UPLOAD = 3000;
  const POLL_INTERVAL_TILES = 10000;
  const POLL_INTERVAL_LISTS = 15000;
  const LIGHT_LABELS = { red: 'Waiting', amber: 'Processing', green: 'Complete' };
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
    viewer: {
      type: null,
      context: null,
      files: [],
      selectedFileId: null,
      selectedIds: new Set(),
      status: null,
      isApplying: false,
    },
  };

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
  const viewerToolbar = document.getElementById('viewer-toolbar');
  const viewerSelectAll = document.getElementById('viewer-select-all');
  const viewerClearSelection = document.getElementById('viewer-clear-selection');
  const viewerApplySchematic = document.getElementById('viewer-apply-schematic');
  const viewerSelectionCount = document.getElementById('viewer-selection-count');
  const viewerStatus = document.getElementById('viewer-status');

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
    const uploadCompleted = records.filter((file) => file.upload === 'green').length;
    const processingCompleted = records.filter((file) => file.processing === 'green').length;

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

  function resetViewerState() {
    state.viewer = {
      type: null,
      context: null,
      files: [],
      selectedFileId: null,
      selectedIds: new Set(),
      status: null,
      isApplying: false,
    };
    if (viewerStatus) {
      viewerStatus.textContent = '';
      viewerStatus.className = 'viewer__status';
    }
  }

  function closeViewer() {
    if (!viewerRoot) return;
    viewerPreviewToken += 1;
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
    resetViewerState();
    renderViewerToolbar();
  }

  function renderViewerSelection() {
    if (!viewerList) return;
    const cards = viewerList.querySelectorAll('.viewer__file');
    cards.forEach((card) => {
      const fileId = card.dataset.fileId || null;
      const isPreviewed = fileId && fileId === state.viewer.selectedFileId;
      const isMarked = fileId ? state.viewer.selectedIds.has(fileId) : false;
      card.classList.toggle('is-selected', isPreviewed);
      card.classList.toggle('is-marked', isMarked);
      const checkbox = card.querySelector('.viewer__file-checkbox');
      if (checkbox) {
        checkbox.checked = isMarked;
      }
    });
    renderViewerToolbar();
  }

  function renderViewerToolbar() {
    if (!viewerToolbar) return;
    const total = Array.isArray(state.viewer.files) ? state.viewer.files.length : 0;
    if (!(state.viewer.selectedIds instanceof Set)) {
      state.viewer.selectedIds = new Set();
    }
    const selectedCount = state.viewer.selectedIds.size;
    if (viewerSelectionCount) {
      viewerSelectionCount.textContent = selectedCount
        ? `${selectedCount} selected`
        : total
          ? 'No files selected'
          : 'No documents available';
    }
    if (viewerSelectAll) {
      viewerSelectAll.disabled = !total || selectedCount === total || state.viewer.isApplying;
    }
    if (viewerClearSelection) {
      viewerClearSelection.disabled = !selectedCount || state.viewer.isApplying;
    }
    if (viewerApplySchematic) {
      viewerApplySchematic.disabled = !selectedCount || state.viewer.isApplying;
      viewerApplySchematic.classList.toggle('is-busy', state.viewer.isApplying);
    }
  }

  function setViewerStatus(message, tone = 'muted') {
    if (!viewerStatus) return;
    viewerStatus.textContent = message || '';
    viewerStatus.className = `viewer__status viewer__status--${tone}`;
    state.viewer.status = { message, tone };
  }

  function toggleViewerSelection(fileId, force) {
    if (!fileId) return;
    if (!(state.viewer.selectedIds instanceof Set)) {
      state.viewer.selectedIds = new Set();
    }
    const shouldSelect = force != null ? force : !state.viewer.selectedIds.has(fileId);
    if (shouldSelect) {
      state.viewer.selectedIds.add(fileId);
    } else {
      state.viewer.selectedIds.delete(fileId);
    }
    renderViewerSelection();
  }

  function clearViewerSelection() {
    state.viewer.selectedIds = new Set();
    renderViewerSelection();
  }

  function selectAllViewerFiles() {
    const ids = Array.isArray(state.viewer.files) ? state.viewer.files.map((file) => file.fileId).filter(Boolean) : [];
    state.viewer.selectedIds = new Set(ids);
    renderViewerSelection();
  }

  function getViewerFileById(fileId) {
    if (!fileId || !Array.isArray(state.viewer.files)) return null;
    return state.viewer.files.find((file) => file.fileId === fileId) || null;
  }

  function inferDocTypeFromViewerType(type) {
    switch (type) {
      case 'payslip':
        return 'payslip';
      case 'statement':
        return 'current_account_statement';
      default:
        return null;
    }
  }

  function getDocTypeForFile(file) {
    if (!file) return null;
    return file.catalogueKey || file?.raw?.catalogueKey || inferDocTypeFromViewerType(state.viewer.type);
  }

  async function postApplySchematics({ docIds, docType }) {
    if (!Array.isArray(docIds) || !docIds.length) {
      throw new Error('Select at least one document.');
    }
    if (!docType) {
      throw new Error('Document type is required to apply schematics.');
    }
    try {
      if (window.Auth && typeof Auth.requireAuth === 'function') {
        await Auth.requireAuth();
      }
    } catch (error) {
      handleUnauthorised('Please sign in again to apply schematics.');
      throw new Error('Not authorised');
    }
    const response = await authFetch('/api/schematics/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docIds, docType }),
    });
    if (response.status === 401) {
      handleUnauthorised('Please sign in again to apply schematics.');
      throw new Error('Not authorised');
    }
    const payload = await safeJson(response);
    if (!response.ok) {
      throw new Error(payload?.error || 'Failed to apply schematic');
    }
    return payload;
  }

  async function applySchematicsToSelection() {
    if (!(state.viewer.selectedIds instanceof Set) || state.viewer.selectedIds.size === 0) {
      setViewerStatus('Select one or more documents to apply a schematic.', 'muted');
      return;
    }
    const ids = Array.from(state.viewer.selectedIds);
    const docTypes = new Set();
    let missingType = false;
    ids.forEach((id) => {
      const file = getViewerFileById(id);
      const docType = getDocTypeForFile(file);
      if (docType) {
        docTypes.add(docType);
      } else {
        missingType = true;
      }
    });
    if (missingType) {
      setViewerStatus('Some selected documents do not expose a document type yet.', 'error');
      return;
    }
    if (docTypes.size !== 1) {
      setViewerStatus('Select documents from the same document type before applying a schematic.', 'error');
      return;
    }
    const [docType] = Array.from(docTypes.values());
    const label = ids.length === 1 ? 'document' : 'documents';
    state.viewer.isApplying = true;
    const originalLabel = viewerApplySchematic ? viewerApplySchematic.textContent : null;
    if (viewerApplySchematic) {
      viewerApplySchematic.textContent = 'Applying…';
    }
    renderViewerToolbar();
    setViewerStatus(`Applying schematic to ${ids.length} ${label}…`, 'info');
    try {
      await postApplySchematics({ docIds: ids, docType });
      setViewerStatus(`Schematic applied to ${ids.length} ${label}.`, 'success');
    } catch (error) {
      if (error.message === 'Not authorised') return;
      console.error('Failed to apply schematic selection', error);
      setViewerStatus(error.message || 'Unable to apply schematic right now.', 'error');
    } finally {
      state.viewer.isApplying = false;
      if (viewerApplySchematic) {
        viewerApplySchematic.textContent = originalLabel || 'Apply schematic';
      }
      renderViewerToolbar();
    }
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
      .vault-json-modal__meta { padding: 12px 20px 0; font-size: 0.85rem; color: var(--viewer-muted, rgba(15, 23, 42, 0.6)); display: flex; flex-wrap: wrap; gap: 8px 12px; }
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
      if (state.viewer.selectedIds instanceof Set) {
        state.viewer.selectedIds.delete(fileId);
      }
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
    const docType = getDocTypeForFile(file);
    if (docType) {
      card.dataset.docType = docType;
    }
    if (state.viewer.selectedFileId === file.fileId) {
      card.classList.add('is-selected');
    }

    const header = document.createElement('div');
    header.className = 'viewer__file-header';
    const selectWrap = document.createElement('label');
    selectWrap.className = 'viewer__file-select';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'viewer__file-checkbox';
    checkbox.checked = state.viewer.selectedIds.has(file.fileId);
    checkbox.addEventListener('click', (event) => {
      event.stopPropagation();
    });
    checkbox.addEventListener('change', (event) => {
      event.stopPropagation();
      toggleViewerSelection(file.fileId, event.target.checked);
    });
    const faux = document.createElement('span');
    faux.className = 'viewer__file-checkbox-visual';
    selectWrap.append(checkbox, faux);

    const heading = document.createElement('div');
    heading.className = 'viewer__file-heading';
    const title = document.createElement('h4');
    title.className = 'viewer__file-title';
    title.textContent = file.title || 'Document';
    heading.appendChild(title);
    if (file.subtitle) {
      const subtitle = document.createElement('span');
      subtitle.className = 'viewer__file-subtitle muted';
      subtitle.textContent = file.subtitle;
      heading.appendChild(subtitle);
    }
    header.append(selectWrap, heading);
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

    let jsonButton = null;
    if (jsonTestEnabled) {
      jsonButton = document.createElement('button');
      jsonButton.type = 'button';
      jsonButton.textContent = 'JSON';
      jsonButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        showJsonForFile(file, jsonButton);
      });
      actions.appendChild(jsonButton);
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
      renderViewerToolbar();
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
    state.viewer.selectedIds = new Set();
    state.viewer.status = null;
    state.viewer.isApplying = false;
    viewerRoot.setAttribute('aria-hidden', 'false');
    if (viewerTitle) viewerTitle.textContent = title || 'Documents';
    if (viewerSubtitle) viewerSubtitle.textContent = subtitle || '';
    if (viewerStatus) {
      viewerStatus.textContent = '';
      viewerStatus.className = 'viewer__status';
    }
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
              upload: file.upload || 'amber',
              processing: file.processing || 'red',
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
    const name = document.createElement('div');
    name.className = 'filename';
    name.textContent = file.originalName;
    row.appendChild(name);

    const uploadLight = createLight('Upload', file.upload || 'amber');
    const processingLight = createLight('Processing', file.processing || 'red');

    const lights = document.createElement('div');
    lights.className = 'lights';
    lights.append(uploadLight, processingLight);
    row.appendChild(lights);

    const message = document.createElement('div');
    message.className = 'message muted';
    message.textContent = file.message || '';
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

    const lights = document.createElement('div');
    lights.className = 'lights';
    lights.appendChild(createLight('Upload', 'red'));
    lights.appendChild(createLight('Processing', 'red'));
    row.appendChild(lights);

    const message = document.createElement('div');
    message.className = 'message muted';
    message.textContent = entry.reason || 'Rejected';
    row.appendChild(message);
    return row;
  }

  function createLight(label, stateValue) {
    const light = document.createElement('span');
    light.className = 'light';
    light.dataset.state = stateValue;
    light.setAttribute('role', 'status');
    light.setAttribute('tabindex', '0');
    light.setAttribute('aria-label', `${label}: ${LIGHT_LABELS[stateValue] || stateValue}`);
    return light;
  }

  function normaliseFileRecord(sessionId, file) {
    const record = state.files.get(file.fileId) || {
      sessionId,
      fileId: file.fileId,
      upload: 'amber',
      processing: 'red',
      message: '',
    };
    if (file.originalName) {
      record.originalName = file.originalName;
    }
    if (file.upload) {
      record.upload = file.upload;
    } else if (!record.upload) {
      record.upload = 'amber';
    }
    if (file.processing) {
      record.processing = file.processing;
    } else if (!record.processing) {
      record.processing = 'red';
    }
    if (file.message != null) {
      record.message = file.message;
    } else if (record.message == null) {
      record.message = '';
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
        const record = normaliseFileRecord(sessionId, { ...file, upload: 'green', processing: 'red' });
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
      const previousProcessing = record.processing;
      record.upload = data.upload || record.upload;
      record.processing = data.processing || record.processing;
      record.message = data.message || '';
      const session = state.sessions.get(record.sessionId);
      if (session) {
        session.files.set(fileId, record);
      }
      renderSessionPanel();
      if (previousProcessing !== 'green' && record.processing === 'green') {
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
      const files = Array.isArray(data?.files)
        ? data.files.map((file) => {
            const metrics = file?.metrics || {};
            const currency = metrics.currency || metrics.currencyCode || 'GBP';
            const payDate = metrics.payDate || file.documentDate || file.documentMonth;
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
            return {
              fileId: file.fileId,
              title: formatDate(payDate) || 'Payslip',
              subtitle: metrics.payFrequency ? `${metrics.payFrequency} payslip` : 'Payslip',
              summary: [
                { label: 'Date of payslip', value: formatDate(payDate) },
                { label: 'Total earnings', value: formatMoney(totalEarnings, currency) },
                { label: 'Total deductibles', value: formatMoney(totalDeductions, currency) },
                { label: 'Net pay', value: formatMoney(netPay, currency) },
              ],
              details,
              metrics,
              raw: file,
              currency,
              catalogueKey: file.catalogueKey || file.docType || 'payslip',
              isExpanded: false,
            };
          })
        : [];
      const employerName = employer.name || data?.employer || 'Employer';
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

  function openSchematicBuilder(docType) {
    if (!docType) return;
    const base = new URL('/schematics', window.location.origin);
    base.searchParams.set('docType', docType);
    window.open(base.toString(), '_blank', 'noopener');
  }

  async function applySchematicsForEmployer(employer, button) {
    if (!employer?.employerId) return;
    const docTypeFallback = 'payslip';
    const appliedLabel = employer.name || 'employer';
    const originalLabel = button ? button.textContent : null;
    if (button) {
      button.disabled = true;
      button.textContent = 'Applying…';
    }
    try {
      const response = await apiFetch(`/payslips/employers/${encodeURIComponent(employer.employerId)}/files`);
      if (response.status === 401) {
        handleUnauthorised('Please sign in again to apply schematics.');
        return;
      }
      if (!response.ok) {
        const text = await safeJson(response);
        throw new Error(text?.error || 'Unable to load payslips for schematics.');
      }
      const data = await response.json();
      const groups = new Map();
      const files = Array.isArray(data?.files) ? data.files : [];
      files.forEach((file) => {
        if (!file?.fileId) return;
        const docType = file.catalogueKey || docTypeFallback;
        if (!groups.has(docType)) {
          groups.set(docType, []);
        }
        groups.get(docType).push(file.fileId);
      });
      if (!groups.size) {
        window.alert('No payslips are ready for schematics yet.');
        return;
      }
      let total = 0;
      for (const [docType, docIds] of groups.entries()) {
        await postApplySchematics({ docIds, docType });
        total += docIds.length;
      }
      window.alert(`Schematic applied to ${total} payslip${total === 1 ? '' : 's'} for ${appliedLabel}.`);
    } catch (error) {
      if (error.message === 'Not authorised') return;
      console.error('Failed to apply schematics for employer', error);
      window.alert(error.message || 'Unable to apply schematics right now.');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalLabel || 'Apply schematic';
      }
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
      const actions = document.createElement('div');
      actions.className = 'grid-card__actions';
      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'grid-card__action';
      applyBtn.textContent = 'Apply schematic';
      applyBtn.disabled = !(employer.count > 0);
      applyBtn.title = employer.count ? 'Apply the active schematic to all documents' : 'No documents ready yet';
      applyBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        applySchematicsForEmployer(employer, applyBtn);
      });
      const builderBtn = document.createElement('button');
      builderBtn.type = 'button';
      builderBtn.className = 'grid-card__action';
      builderBtn.textContent = 'Open builder';
      builderBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        openSchematicBuilder('payslip');
      });
      actions.append(applyBtn, builderBtn);
      card.appendChild(actions);
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

  async function applySchematicsForInstitution(institution, button) {
    if (!institution?.institutionId) return;
    const originalLabel = button ? button.textContent : null;
    if (button) {
      button.disabled = true;
      button.textContent = 'Applying…';
    }
    try {
      const response = await apiFetch(`/statements/institutions/${encodeURIComponent(institution.institutionId)}/files`);
      if (response.status === 401) {
        handleUnauthorised('Please sign in again to apply schematics.');
        return;
      }
      if (!response.ok) {
        const text = await safeJson(response);
        throw new Error(text?.error || 'Unable to load statements for schematics.');
      }
      const data = await response.json();
      const groups = new Map();
      const accounts = Array.isArray(data?.accounts) ? data.accounts : [];
      accounts.forEach((account) => {
        const files = Array.isArray(account?.files) ? account.files : [];
        files.forEach((file) => {
          if (!file?.fileId) return;
          const docType = file.catalogueKey || file.docType || inferDocTypeFromViewerType('statement');
          if (!groups.has(docType)) {
            groups.set(docType, []);
          }
          groups.get(docType).push(file.fileId);
        });
      });
      if (!groups.size) {
        window.alert('No statements are ready for schematics yet.');
        return;
      }
      let total = 0;
      for (const [docType, docIds] of groups.entries()) {
        await postApplySchematics({ docIds, docType });
        total += docIds.length;
      }
      const label = institution.name || 'institution';
      window.alert(`Schematic applied to ${total} statement${total === 1 ? '' : 's'} for ${label}.`);
    } catch (error) {
      if (error.message === 'Not authorised') return;
      console.error('Failed to apply schematics for institution', error);
      window.alert(error.message || 'Unable to apply schematics right now.');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalLabel || 'Apply schematic';
      }
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
      const files = [];
      const accounts = Array.isArray(data?.accounts) ? data.accounts : [];
      accounts.forEach((account) => {
        const accountName = account.displayName || normaliseStatementName(data?.institution?.name || institution.name);
        const maskedNumber = account.accountNumberMasked || null;
        const accountType = account.accountType || null;
        const accountFiles = Array.isArray(account.files) ? account.files : [];
        accountFiles.forEach((file) => {
          const metrics = file?.metrics || {};
          const currency = metrics.currency || metrics.currencyCode || 'GBP';
          const totalIn = pickMetric(metrics, ['totalIn', 'totalCredit', 'totalCredits', 'sumCredits', 'creditsTotal']);
          const totalOut = pickMetric(metrics, ['totalOut', 'totalDebit', 'totalDebits', 'sumDebits', 'debitsTotal']);
          const periodStart = metrics.periodStart || metrics.period?.start || metrics.period?.from || metrics.statementPeriod?.start;
          const periodEnd = metrics.periodEnd || metrics.period?.end || metrics.period?.to || metrics.statementPeriod?.end;
          const openingBalance = pickMetric(metrics, ['openingBalance', 'startingBalance']);
          const closingBalance = pickMetric(metrics, ['closingBalance', 'endingBalance']);
          const details = [];
          if (periodStart) details.push({ label: 'Period start', value: formatDate(periodStart) });
          if (periodEnd) details.push({ label: 'Period end', value: formatDate(periodEnd) });
          if (openingBalance != null) details.push({ label: 'Opening balance', value: formatMoney(openingBalance, currency) });
          if (closingBalance != null) details.push({ label: 'Closing balance', value: formatMoney(closingBalance, currency) });
          if (metrics.currency) details.push({ label: 'Currency', value: metrics.currency });
          if (accountType) details.push({ label: 'Account type', value: accountType });
          files.push({
            fileId: file.fileId,
            title: accountName || 'Statement',
            subtitle: periodEnd ? `Statement ending ${formatDate(periodEnd)}` : (file.documentDate ? `Statement ${formatDate(file.documentDate)}` : 'Statement'),
            summary: [
              { label: 'Account number', value: file.accountNumberMasked || maskedNumber || '—' },
              { label: 'Total in', value: formatMoney(totalIn, currency) },
              { label: 'Total out', value: formatMoney(totalOut, currency) },
            ],
            details,
            metrics,
            raw: file,
            currency,
            catalogueKey: file.catalogueKey || file.docType || inferDocTypeFromViewerType('statement'),
            isExpanded: false,
          });
        });
      });
      showViewer({
        type: 'statement',
        title: normaliseStatementName(institution.name || data?.institution?.name),
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
      const actions = document.createElement('div');
      actions.className = 'grid-card__actions';
      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'grid-card__action';
      applyBtn.textContent = 'Apply schematic';
      applyBtn.disabled = !(inst.accounts > 0);
      applyBtn.title = inst.accounts ? 'Apply the active schematic to all documents' : 'No accounts available yet';
      applyBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        applySchematicsForInstitution(inst, applyBtn);
      });
      const builderBtn = document.createElement('button');
      builderBtn.type = 'button';
      builderBtn.className = 'grid-card__action';
      builderBtn.textContent = 'Open builder';
      builderBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        openSchematicBuilder(inferDocTypeFromViewerType('statement') || 'statement');
      });
      actions.append(applyBtn, builderBtn);
      card.appendChild(actions);
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
  if (viewerSelectAll) {
    viewerSelectAll.addEventListener('click', (event) => {
      event.preventDefault();
      selectAllViewerFiles();
    });
  }
  if (viewerClearSelection) {
    viewerClearSelection.addEventListener('click', (event) => {
      event.preventDefault();
      clearViewerSelection();
    });
  }
  if (viewerApplySchematic) {
    viewerApplySchematic.addEventListener('click', (event) => {
      event.preventDefault();
      applySchematicsToSelection();
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
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
