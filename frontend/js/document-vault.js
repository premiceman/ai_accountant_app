// frontend/js/document-vault.js
// Document Vault wiring with robust payload normalization + front-end fallbacks
// Adds: per-collection Delete + Download ZIP actions (minimal UI), dbl-click rename stays.
(function () {
  // ---------------- DOM helpers ----------------
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const on = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts);

  // ---------------- Elements ----------------
  // KPIs
  const elFileCount = $('#file-count') || $('#m-files');
  const elTotalGB   = $('#total-gb')   || $('#m-storage');
  const elUpdated   = $('#m-updated'); // optional

  // Collections
  const elCollectionsList =
    $('#collections-list') || $('#collection-list') || $('#collections');
  const elCollectionSearch = $('#collection-search');
  const elNewCollectionBtn = $('#new-collection-btn') || $('#btn-new-col');
  const elNewCollectionModal = $('#new-collection-modal');
  const elNewCollectionForm  = $('#new-collection-form');
  const elNewCollectionName  = $('#new-collection-name');
  const elCollectionCount    = $('#collection-count'); // KPI bubble

  // Documents (within a collection)
  const elDocumentsList = $('#documents-list') || $('#document-list') || $('#file-list');
  const elBackToCollections = $('#back-to-collections') || $('#btn-back');
  const elCurrentCollectionName = $('#current-collection-name') || $('#panel-name');

  // Upload / Dropzone
  const elDropzone  = $('#dropzone');
  const elFileInput = $('#file-input');

  // Preview area
  const elPreviewFrame = $('#preview-frame');
  const elPreviewEmpty = $('#preview-empty');
  const elPreviewFilename = $('#preview-filename');

  // Sections
  const elCollectionsSection = $('#collections-section') || $('#collections');

  // Catalogue checklist
  const elCatalogueTableBody = $('#doc-catalogue-body');
  const elCatalogueMsg = $('#doc-catalogue-msg');
  const elDocProgressRequiredBar = $('#doc-progress-required-bar');
  const elDocProgressRequiredCount = $('#doc-progress-required-count');
  const elDocProgressHelpfulBar = $('#doc-progress-helpful-bar');
  const elDocProgressHelpfulCount = $('#doc-progress-helpful-count');
  const elDocProgressAnalyticsBar = $('#doc-progress-analytics-bar');
  const elDocProgressAnalyticsCount = $('#doc-progress-analytics-count');
  const elDocProgressUpdated = $('#doc-progress-updated');
  const elDocFilesPanel = $('#doc-files-panel');
  const elDocFilesTitle = $('#doc-files-title');
  const elDocFilesTableBody = $('#doc-files-table-body');
  const elDocFilesClose = $('#doc-files-close');

  // State
  let collections = [];
  let currentCol = null;
  let _didFallbackStats = false;
  let _didFallbackCollectionMetrics = false;
  let catalogue = [];
  let catalogueByKey = new Map();
  let catalogueEntries = {};
  let catalogueProgress = {
    required: { total: 0, completed: 0 },
    helpful: { total: 0, completed: 0 },
    analytics: { total: 0, completed: 0 },
    updatedAt: null
  };
  let activeDocKey = null;
  const preferredCatalogueKeys = parsePreferredCatalogueKeys();
  let processingByKey = {};
  const pendingUploads = [];

  // ---------------- Utilities ----------------
  function toNumber(x) {
    if (x == null) return 0;
    if (typeof x === 'number' && isFinite(x)) return x;
    if (typeof x === 'string') {
      const n = Number(x.replace?.(/[, ]+/g, '') ?? x);
      return isFinite(n) ? n : 0;
    }
    return 0;
  }
  function pickNumber(...cands) {
    for (const c of cands) {
      const n = toNumber(c);
      if (n) return n;
      if (c === 0) return 0;
    }
    return 0;
  }
  function pickString(...cands) {
    for (const c of cands) {
      if (typeof c === 'string' && c.trim()) return c;
    }
    return '';
  }

  function parsePreferredCatalogueKeys() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      const raw = params.get('catalogueKey') || params.get('catalogue');
      if (!raw) return [];
      return raw
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
    } catch (err) {
      console.warn('Unable to parse catalogueKey query param', err);
      return [];
    }
  }

  function ensurePreferredSelection() {
    if (!preferredCatalogueKeys.length) return;
    if (activeDocKey && preferredCatalogueKeys.includes(activeDocKey)) return;
    const candidate = preferredCatalogueKeys.find((key) => catalogueByKey.has(key));
    if (candidate) {
      activeDocKey = candidate;
    }
  }
  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function animateAndRemove(element, className = 'is-deleting', duration = 360) {
    return new Promise((resolve) => {
      if (!element) return resolve();
      let resolved = false;
      const cleanup = () => {
        if (resolved) return;
        resolved = true;
        element.removeEventListener('animationend', onEnd);
        element.removeEventListener('transitionend', onEnd);
        clearTimeout(timer);
        if (element.isConnected) {
          element.remove();
        }
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
  function fmtBytes(bytes) {
    const b = Number(bytes || 0);
    if (b <= 0) return '0 B';
    const u = ['B','KB','MB','GB','TB','PB'];
    const i = Math.floor(Math.log(b) / Math.log(1024));
    return `${(b / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
  }
  function niceDate(d) { return d ? new Date(d).toLocaleString() : '—'; }
  function fmtDateTime(d) {
    try {
      if (!d) return '—';
      const date = d instanceof Date ? d : new Date(d);
      if (Number.isNaN(date.getTime())) return '—';
      return date.toLocaleString();
    } catch { return '—'; }
  }
  function statusBadge(latest, overdue) {
    if (!latest) return '<span class="badge text-bg-secondary">Missing</span>';
    if (overdue) return '<span class="badge text-bg-warning">Overdue</span>';
    return '<span class="badge text-bg-success">Up to date</span>';
  }
  function toDateLike(val) {
    if (!val) return null;
    if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val;
    const d = new Date(val);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  function isOverdue(cadence, lastInput) {
    if (!cadence || cadence.adhoc) return false;
    const last = toDateLike(lastInput);
    const now = new Date();
    if (cadence.yearlyBy) {
      const [mm, dd] = String(cadence.yearlyBy).split('-').map(Number);
      const due = new Date(now.getFullYear(), (mm ? mm - 1 : 0), dd || 1);
      if (now <= due) return false;
      if (!last) return true;
      return last < due;
    }
    if (cadence.months) {
      if (!last) return true;
      const next = new Date(last);
      next.setMonth(next.getMonth() + cadence.months);
      return now > next;
    }
    if (!last) return true;
    const next = new Date(last);
    next.setFullYear(next.getFullYear() + 1);
    return now > next;
  }
  function dueLabel(cadence, lastInput) {
    if (!cadence || cadence.adhoc) return 'As needed';
    const last = toDateLike(lastInput);
    const now = new Date();
    if (cadence.yearlyBy) {
      const [mm, dd] = String(cadence.yearlyBy).split('-').map(Number);
      const due = new Date(now.getFullYear(), (mm ? mm - 1 : 0), dd || 1);
      if (now > due && (!last || last < due)) {
        return `Overdue (was due ${due.toLocaleDateString()})`;
      }
      return `Due by ${due.toLocaleDateString()}`;
    }
    if (cadence.months) {
      if (!last) return 'Overdue (no upload yet)';
      const next = new Date(last);
      next.setMonth(next.getMonth() + cadence.months);
      if (now > next) return `Overdue (was due ${next.toLocaleDateString()})`;
      return `Due ${next.toLocaleDateString()}`;
    }
    if (!last) return 'Overdue (no upload yet)';
    const next = new Date(last);
    next.setFullYear(next.getFullYear() + 1);
    if (now > next) return `Overdue (was due ${next.toLocaleDateString()})`;
    return `Due ${next.toLocaleDateString()}`;
  }

  // Normalize server payloads
  function normalizeStats(s) {
    if (!s || typeof s !== 'object') return { totalFiles: 0, totalBytes: 0, totalGB: 0 };
    const totalFiles = pickNumber(
      s.totalFiles, s.files, s.count, s.fileCount, s.filesCount, s.stats?.files
    );
    const totalBytes = pickNumber(
      s.totalBytes, s.bytes, s.sizeBytes, s.storageBytes, s.usedBytes, s.usage?.bytes, s.storage?.bytes
    );
    const totalGB = pickNumber(s.totalGB, s.gb, s.storageGB); // optional
    const lastUpdated = pickString(s.lastUpdated, s.updatedAt, s.lastModified, s.stats?.updatedAt);
    return { totalFiles, totalBytes, totalGB, lastUpdated };
  }

  function normalizeCollection(c) {
    if (!c || typeof c !== 'object') return null;
    const id   = pickString(c.id, c._id, c.collectionId, c.uuid, String(c.id ?? ''));
    const name = pickString(c.name, c.title, c.label, `Collection ${id || ''}`) || 'Untitled';
    const fileCount = pickNumber(c.fileCount, c.files, c.count, c.stats?.files, c.totalFiles);
    const bytes = pickNumber(c.bytes, c.totalBytes, c.sizeBytes, c.storageBytes, c.usage?.bytes, c.size);
    const locked = !!(c.locked || c.readOnly);
    const category = c.category ? String(c.category) : null;
    const system = !!c.system;
    return { id, name, fileCount, bytes, locked, category, system, _raw: c };
  }

  function normalizeFilesPayload(j) {
    const list = Array.isArray(j) ? j : (j?.files || j?.items || j?.data || []);
    return list.map(f => ({
      id: pickString(f.id, f._id, f.fileId, String(f.id ?? '')),
      name: pickString(f.name, f.filename, f.title, 'document'),
      size: pickNumber(f.size, f.bytes, f.length, f.fileSize),
      uploadedAt: pickString(f.uploadedAt, f.createdAt, f.timeCreated, f.timestamp),
      viewUrl: pickString(f.viewUrl, f.previewUrl, f.url, f.href),
      downloadUrl: pickString(f.downloadUrl, f.url, f.href),
      catalogueKey: pickString(f.catalogueKey, f.catalog, f.docKey)
    }));
  }

  // Load auth helper if page forgot to include it
  async function ensureAuthHelper() {
    if (window.Auth) return;
    await new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = '/js/auth.js';
      s.onload = resolve;
      s.onerror = resolve;
      document.head.appendChild(s);
    });
  }

  function updateKPIsFromStats(statsRaw) {
    const stats = normalizeStats(statsRaw);
    if (elFileCount) elFileCount.textContent = stats.totalFiles ?? 0;

    if (elTotalGB) {
      if (stats.totalGB) {
        elTotalGB.textContent = `${stats.totalGB} GB`;
      } else {
        elTotalGB.textContent = fmtBytes(stats.totalBytes || 0);
      }
    }
    if (elUpdated) elUpdated.textContent = niceDate(stats.lastUpdated);
  }

  function setPreviewSrc(url, filename) {
    if (!elPreviewFrame || !elPreviewEmpty || !elPreviewFilename) return;
    if (url && url !== 'about:blank') {
      elPreviewFrame.classList.remove('d-none');
      elPreviewEmpty.classList.add('d-none');
      elPreviewFrame.src = url;
      elPreviewFilename.textContent = filename || '';
    } else {
      elPreviewFrame.classList.add('d-none');
      elPreviewEmpty.classList.remove('d-none');
      elPreviewFrame.src = 'about:blank';
      elPreviewFilename.textContent = '';
    }
  }

  async function previewFile(viewUrl, name) {
    try {
      const r = await Auth.fetch(viewUrl);
      if (!r.ok) { const t = await r.text().catch(()=> ''); alert(t || 'Preview failed'); return; }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      setPreviewSrc(url, name);
    } catch (e) {
      console.error(e);
      alert('Preview failed.');
    }
  }

  async function downloadFile(dlUrl, name) {
    try {
      const r = await Auth.fetch(dlUrl);
      if (!r.ok) { const t = await r.text().catch(()=> ''); alert(t || 'Download failed'); return; }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (name || 'document.pdf').replace(/[\\/:*?"<>|]+/g, '_');
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      console.error(e);
      alert('Download failed.');
    }
  }

  // ---------------- Catalogue checklist ----------------
  function updateCatalogueProgressDisplay() {
    const req = catalogueProgress?.required || { total: 0, completed: 0 };
    const help = catalogueProgress?.helpful || { total: 0, completed: 0 };
    const analytics = catalogueProgress?.analytics || { total: 0, completed: 0 };
    const reqPct = req.total ? Math.round((req.completed / req.total) * 100) : 0;
    const helpPct = help.total ? Math.round((help.completed / help.total) * 100) : 0;
    const analyticsPct = analytics.total ? Math.round((analytics.completed / analytics.total) * 100) : 0;

    if (elDocProgressRequiredBar) {
      elDocProgressRequiredBar.style.width = `${Math.max(0, Math.min(100, reqPct))}%`;
      elDocProgressRequiredBar.setAttribute('aria-valuenow', String(reqPct));
    }
    if (elDocProgressRequiredCount) {
      elDocProgressRequiredCount.textContent = `${req.completed} / ${req.total}`;
    }
    if (elDocProgressHelpfulBar) {
      elDocProgressHelpfulBar.style.width = `${Math.max(0, Math.min(100, helpPct))}%`;
      elDocProgressHelpfulBar.setAttribute('aria-valuenow', String(helpPct));
    }
    if (elDocProgressHelpfulCount) {
      elDocProgressHelpfulCount.textContent = `${help.completed} / ${help.total}`;
    }
    if (elDocProgressAnalyticsBar) {
      elDocProgressAnalyticsBar.style.width = `${Math.max(0, Math.min(100, analyticsPct))}%`;
      elDocProgressAnalyticsBar.setAttribute('aria-valuenow', String(analyticsPct));
    }
    if (elDocProgressAnalyticsCount) {
      elDocProgressAnalyticsCount.textContent = `${analytics.completed} / ${analytics.total}`;
    }
    if (elDocProgressUpdated) {
      elDocProgressUpdated.textContent = catalogueProgress?.updatedAt
        ? `Updated ${niceDate(catalogueProgress.updatedAt)}`
        : 'Updated —';
    }
  }

  function renderCatalogue() {
    ensurePreferredSelection();
    updateCatalogueProgressDisplay();
    if (!elCatalogueTableBody) return;

    if (!Array.isArray(catalogue) || !catalogue.length) {
      elCatalogueTableBody.innerHTML = '<div class="text-muted small">No document checklist configured.</div>';
      return;
    }

    elCatalogueTableBody.innerHTML = '';
    for (const item of catalogue) {
      const state = catalogueEntries[item.key] || {};
      const files = Array.isArray(state.files) ? state.files : [];
      const latest = files[0] || null;
      const lastUploaded = latest?.uploadedAt ? toDateLike(latest.uploadedAt) : null;
      const overdue = isOverdue(item.cadence, lastUploaded);

      const details = document.createElement('details');
      details.dataset.key = item.key;
      if (activeDocKey && activeDocKey === item.key) details.setAttribute('open', 'open');
      if (preferredCatalogueKeys.includes(item.key)) details.classList.add('preferred-doc');

      const summary = document.createElement('summary');
      summary.innerHTML = `
        <span>${escapeHtml(item.label)}</span>
        <div class="doc-meta">
          <span><i class="bi bi-check-circle"></i>${item.required ? 'Required' : 'Helpful'}</span>
          ${item.analytics ? '<span><i class="bi bi-bar-chart"></i>Analytics source</span>' : ''}
          <span>${statusBadge(latest, overdue)}</span>
          <span><i class="bi bi-clock-history"></i>${lastUploaded ? fmtDateTime(lastUploaded) : 'No upload yet'}</span>
          <span><i class="bi bi-calendar-event"></i>${dueLabel(item.cadence, lastUploaded)}</span>
        </div>
      `;
      details.appendChild(summary);

      const body = document.createElement('div');
      body.className = 'doc-body';
      body.innerHTML = `
        <div class="mb-2"><strong>Why:</strong> ${escapeHtml(item.why)}</div>
        <div class="mb-2"><strong>Where:</strong> ${escapeHtml(item.where)}</div>
      `;

      const actions = document.createElement('div');
      actions.className = 'doc-actions';
      const uploadBtn = document.createElement('button');
      uploadBtn.type = 'button';
      uploadBtn.className = 'btn btn-sm btn-primary';
      uploadBtn.innerHTML = '<i class="bi bi-upload me-1"></i>Upload';
      on(uploadBtn, 'click', (e) => { e.preventDefault(); triggerCatalogueUpload(item.key); });
      const reviewBtn = document.createElement('button');
      reviewBtn.type = 'button';
      reviewBtn.className = 'btn btn-sm btn-outline-secondary';
      reviewBtn.innerHTML = '<i class="bi bi-folder2-open me-1"></i>Review uploads';
      on(reviewBtn, 'click', (e) => { e.preventDefault(); renderCatalogueFiles(item.key); });
      actions.appendChild(uploadBtn);
      actions.appendChild(reviewBtn);

      body.appendChild(actions);
      details.appendChild(body);
      elCatalogueTableBody.appendChild(details);
    }

    if (elCatalogueMsg) {
      elCatalogueMsg.textContent = 'Uploads are automatically stored in their matching default collections.';
    }

    if (activeDocKey) {
      renderCatalogueFiles(activeDocKey);
    }
  }

  function renderCatalogueFiles(key) {
    if (!elDocFilesPanel || !elDocFilesTableBody) return;
    activeDocKey = key;
    const state = catalogueEntries[key] || {};
    const files = Array.isArray(state.files) ? state.files : [];
    const item = catalogueByKey.get(key);
    const entryProcessing = state.processing || processingByKey[key] || null;
    const pendingForKey = pendingUploads.filter((pending) => pending.key === key);

    if (elDocFilesTitle) {
      elDocFilesTitle.textContent = item ? `Uploads — ${item.label}` : 'Uploads';
    }

    elDocFilesPanel.classList.remove('d-none');

    if (!files.length && !pendingForKey.length) {
      elDocFilesTableBody.innerHTML = '<tr><td colspan="6" class="text-muted small">No uploads yet. Upload from the checklist or collections to get started.</td></tr>';
      return;
    }

    elDocFilesTableBody.innerHTML = '';

    const renderStatus = (file) => {
      const active = Boolean(file.processing || (entryProcessing?.active && entryProcessing?.fileId === file.id));
      if (active) {
        const msg = entryProcessing?.message || 'Processing…';
        return `<div class="processing-indicator"><div class="spinner-border text-primary" role="status" aria-hidden="true"></div><span class="small">${escapeHtml(msg)}</span></div>`;
      }
      if (entryProcessing?.message && entryProcessing?.fileId === file.id) {
        return `<span class="text-muted small">${escapeHtml(entryProcessing.message)}</span>`;
      }
      return '<span class="badge text-bg-success">Ready</span>';
    };

    for (const file of files) {
      const row = document.createElement('tr');
      const collection = collections.find(c => String(c.id) === String(file.collectionId));
      const collectionName = collection?.name || '—';
      row.innerHTML = `
        <td>${escapeHtml(file.name || 'document.pdf')}</td>
        <td>${fmtDateTime(file.uploadedAt)}</td>
        <td>${fmtBytes(file.size)}</td>
        <td>${renderStatus(file)}</td>
        <td>${escapeHtml(collectionName)}</td>
        <td class="text-end">
          <button type="button" class="btn btn-sm btn-outline-primary" data-file-action="manage">
            <i class="bi bi-folder-symlink"></i> Manage
          </button>
        </td>
      `;

      const manageBtn = row.querySelector('[data-file-action="manage"]');
      on(manageBtn, 'click', async (event) => {
        event.preventDefault();
        if (!collection) {
          alert('This upload is not linked to a visible collection yet.');
          return;
        }
        try {
          await openCollection(collection);
        } finally {
          closeCatalogueFiles();
        }
      });

      elDocFilesTableBody.appendChild(row);
    }

    if (pendingForKey.length) {
      pendingForKey.forEach((pending) => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${escapeHtml(pending.name || 'Uploading…')}</td>
          <td>${fmtDateTime(pending.startedAt)}</td>
          <td>${fmtBytes(pending.size)}</td>
          <td><div class="processing-indicator"><div class="spinner-border text-primary" role="status" aria-hidden="true"></div><span class="small">Processing…</span></div></td>
          <td>—</td>
          <td class="text-end text-muted small">Queued</td>`;
        elDocFilesTableBody.appendChild(row);
      });
    }
  }

  function closeCatalogueFiles() {
    activeDocKey = null;
    if (elDocFilesPanel) elDocFilesPanel.classList.add('d-none');
    if (elDocFilesTableBody) {
      elDocFilesTableBody.innerHTML = '<tr><td colspan="6" class="text-muted small">Select a document above to see recent uploads. Previewing or deleting files happens from the collections panel.</td></tr>';
    }
    renderCatalogue();
  }

  function ensureCollectionForDocKey(key) {
    const doc = catalogueByKey.get(key);
    if (!doc) return;
    const categories = Array.isArray(doc.categories) ? doc.categories : [];
    for (const cat of categories) {
      const match = collections.find((c) => c.category === cat);
      if (match) {
        if (!currentCol || currentCol.id !== match.id) openCollection(match);
        return;
      }
    }
  }

  function triggerCatalogueUpload(key) {
    ensureCollectionForDocKey(key);
    if (!currentCol) {
      alert('Please select a collection on the left before uploading.');
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.jpg,.jpeg,.png,.csv,.heic,.webp';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        await uploadFilesToCurrent([file], { catalogueKey: key });
        if (activeDocKey === key) renderCatalogueFiles(key);
      } catch (err) {
        alert(err?.message || 'Upload failed');
      } finally {
        input.value = '';
      }
    };
    input.click();
  }

  // ---------------- API ----------------
  async function loadStats() {
    const r = await Auth.fetch('/api/vault/stats');
    if (!r.ok) return;
    const s = await r.json().catch(()=> ({}));
    updateKPIsFromStats(s);
  }

  async function loadCatalogue() {
    try {
      const r = await Auth.fetch('/api/vault/catalogue');
      if (!r.ok) throw new Error('Failed to load catalogue');
      const j = await r.json().catch(() => ({}));
      catalogue = Array.isArray(j.catalogue) ? j.catalogue : [];
      catalogueByKey = new Map(catalogue.map(item => [item.key, item]));
      catalogueEntries = j.entries && typeof j.entries === 'object' ? j.entries : {};
      processingByKey = j.processing && typeof j.processing === 'object' ? j.processing : {};
      const progress = j.progress && typeof j.progress === 'object' ? j.progress : {};
      catalogueProgress = {
        required: progress.required || { total: 0, completed: 0 },
        helpful: progress.helpful || { total: 0, completed: 0 },
        analytics: progress.analytics || { total: 0, completed: 0 },
        updatedAt: progress.updatedAt || null
      };
      renderCatalogue();
    } catch (err) {
      console.error('[document-vault] loadCatalogue failed', err);
      catalogue = [];
      catalogueEntries = {};
      catalogueByKey = new Map();
      processingByKey = {};
      catalogueProgress = {
        required: { total: 0, completed: 0 },
        helpful: { total: 0, completed: 0 },
        analytics: { total: 0, completed: 0 },
        updatedAt: null
      };
      if (elCatalogueMsg) elCatalogueMsg.textContent = 'Failed to load document checklist.';
      renderCatalogue();
    }
  }

  async function loadCollections() {
    const r = await Auth.fetch('/api/vault/collections');
    if (!r.ok) {
      if (elCollectionsList) elCollectionsList.innerHTML = '<div class="text-muted small">Failed to load collections.</div>';
      return;
    }
    const j = await r.json().catch(()=> ({}));

    // Accept arrays or various container keys
    const rawList = Array.isArray(j) ? j : (j.collections || j.items || j.data || []);
    collections = (rawList || []).map(normalizeCollection).filter(Boolean);

    renderCollections();
    if (elCollectionCount) elCollectionCount.textContent = String(collections.length);
    if (activeDocKey) renderCatalogueFiles(activeDocKey);
  }

  function renderCollections(filterText = '') {
    if (!elCollectionsList) return;
    elCollectionsList.innerHTML = '';
    const q = (filterText || '').trim().toLowerCase();

    const filtered = q
      ? collections.filter(c => c.name.toLowerCase().includes(q))
      : collections;

    if (!filtered.length) {
      elCollectionsList.innerHTML = '<div class="text-muted small p-2">No collections yet.</div>';
      return;
    }

    for (const c of filtered) {
      const categoryLabel = c.category
        ? `<span class="badge bg-light text-dark border">${escapeHtml(c.category)}</span>`
        : '';
      const row = document.createElement('div');
      row.className = 'collection-item d-flex justify-content-between align-items-center';
      row.dataset.id = c.id;

      row.innerHTML = `
        <div class="d-flex align-items-center gap-2 flex-grow-1 min-w-0">
          <i class="bi bi-folder2 me-1 text-primary"></i>
          <a href="#" class="collection-name text-decoration-none text-reset flex-grow-1 text-truncate">
            ${escapeHtml(c.name)}
          </a>
          <div class="collection-meta text-muted small flex-shrink-0 ms-2" data-meta-for="${escapeHtml(c.id)}">
            ${(c.fileCount || 0)} files · ${fmtBytes(c.bytes || 0)}
          </div>
          ${categoryLabel}
        </div>
        <div class="collection-actions ms-2 flex-shrink-0">
          <button class="btn btn-sm btn-light border me-1" data-col-action="download" title="Download as .zip"><i class="bi bi-download"></i></button>
          ${c.locked ? '' : '<button class="btn btn-sm btn-light border text-danger" data-col-action="delete" title="Delete collection"><i class="bi bi-trash"></i></button>'}
        </div>
      `;

      // Open collection
      on(row.querySelector('.collection-name'), 'click', (e) => { e.preventDefault(); openCollection(c); });

      // Download ZIP
      on(row.querySelector('[data-col-action="download"]'), 'click', async (e) => {
        e.preventDefault(); e.stopPropagation();
        try {
          const resp = await Auth.fetch(`/api/vault/collections/${c.id}/archive`);
          if (!resp.ok) { const t = await resp.text().catch(()=> ''); alert(t || 'Download failed'); return; }
          const blob = await resp.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${(c.name || 'collection').replace(/[\\/:*?"<>|]+/g, '_')}.zip`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1500);
        } catch (err) {
          console.error(err);
          alert('Download failed');
        }
      });

      // Delete collection (with confirmation text exactly as requested)
      if (!c.locked) {
        on(row.querySelector('[data-col-action="delete"]'), 'click', async (e) => {
          e.preventDefault(); e.stopPropagation();
          const ok = confirm('Are you sure you want to delete this collection and all contained files. This action is irreversible');
          if (!ok) return;
          try {
            const resp = await Auth.fetch(`/api/vault/collections/${c.id}`, { method: 'DELETE' });
            if (!resp.ok) { const t = await resp.text().catch(()=> ''); alert(t || 'Delete failed'); return; }
            if (currentCol && String(currentCol.id) === String(c.id)) {
              exitCollectionView();
            }
            await Promise.all([loadCollections(), loadStats()]);
          } catch (err) {
            console.error(err);
            alert('Delete failed');
          }
        });
      }

      elCollectionsList.appendChild(row);
    }

    if (!currentCol && !filterText) {
      const preferred = collections.find((c) => c.category === 'required') || collections[0];
      if (preferred) openCollection(preferred);
    }
  }

  async function openCollection(col) {
    currentCol = col;
    const elCurrentCollectionName = $('#current-collection-name') || $('#panel-name');
    if (elCurrentCollectionName) elCurrentCollectionName.textContent = col?.name || 'All documents';
    if (elBackToCollections) elBackToCollections.classList.remove('d-none');
    if (elCollectionsSection && elCollectionsSection.id === 'collections-section') {
      elCollectionsSection.style.display = 'none';
    }
    await loadFiles();
    renderCatalogue();
  }

  function exitCollectionView() {
    currentCol = null;
    const elCurrentCollectionName = $('#current-collection-name') || $('#panel-name');
    if (elCurrentCollectionName) elCurrentCollectionName.textContent = 'All documents';
    if (elBackToCollections) elBackToCollections.classList.add('d-none');
    setPreviewSrc('about:blank');
    if (elDocumentsList) elDocumentsList.innerHTML = '';
    if (elCollectionsSection && elCollectionsSection.id === 'collections-section') {
      elCollectionsSection.style.display = '';
    }
    renderCatalogue();
  }

  async function loadFiles() {
    if (!currentCol || !elDocumentsList) return;
    elDocumentsList.innerHTML = '<div class="text-muted small p-2">Loading…</div>';

    const r = await Auth.fetch(`/api/vault/collections/${currentCol.id}/files`);
    if (!r.ok) { elDocumentsList.innerHTML = '<div class="text-muted small p-2">Failed to load files.</div>'; return; }
    const j = await r.json().catch(()=> ([]));
    const files = normalizeFilesPayload(j);

    elDocumentsList.innerHTML = '';
    if (!files.length) {
      elDocumentsList.innerHTML = '<div class="text-muted small p-2">No files in this collection.</div>';
    } else {
      for (const f of files) {
        const row = document.createElement('div');
        row.className = 'doc-row';
        row.dataset.id = f.id;
        const docEntry = f.catalogueKey ? catalogueByKey.get(f.catalogueKey) : null;
        const docBadge = docEntry
          ? ` <span class="badge bg-light text-secondary border ms-1">${escapeHtml(docEntry.label)}</span>`
          : '';

        row.innerHTML = `
          <div class="doc-main">
            <i class="bi bi-file-earmark-text text-primary"></i>
            <div class="min-w-0">
              <div class="doc-title" data-filename>${escapeHtml(f.name)}</div>
              <div class="doc-sub">${fmtBytes(f.size)} · ${niceDate(f.uploadedAt)}${docBadge}</div>
            </div>
          </div>
          <div class="doc-actions">
            <button class="btn btn-icon" data-action="preview" title="Preview"><i class="bi bi-eye"></i></button>
            <button class="btn btn-icon" data-action="download" title="Download"><i class="bi bi-download"></i></button>
            <button class="btn btn-icon text-danger" data-action="delete" title="Delete"><i class="bi bi-trash"></i></button>
          </div>
        `;

        on(row.querySelector('[data-action="preview"]'), 'click', () => {
          const url = f.viewUrl || f.downloadUrl;
          if (!url) return alert('No preview URL available.');
          previewFile(url, f.name);
        });
        on(row.querySelector('[data-action="download"]'), 'click', () => {
          const url = f.downloadUrl || f.viewUrl;
          if (!url) return alert('No download URL available.');
          downloadFile(url, f.name);
        });
        const deleteBtn = row.querySelector('[data-action="delete"]');
        on(deleteBtn, 'click', async () => {
          if (!confirm('Delete this file?')) return;
          if (deleteBtn) deleteBtn.disabled = true;
          try {
            const del = await Auth.fetch(`/api/vault/files/${f.id}`, { method: 'DELETE' });
            if (!del.ok) {
              const t = await del.text().catch(() => '');
              throw new Error(t || 'Delete failed');
            }
            await animateAndRemove(row);
            await Promise.all([loadFiles(), loadStats(), loadCollections(), loadCatalogue()]);
            await ensureMetricsAndStats();
            if (activeDocKey) renderCatalogueFiles(activeDocKey);
            setPreviewSrc('about:blank');
          } catch (error) {
            console.error(error);
            alert(error.message || 'Delete failed');
          } finally {
            if (deleteBtn?.isConnected) deleteBtn.disabled = false;
          }
        });

        // dbl-click rename (kept as before)
        const titleEl = row.querySelector('.doc-title[data-filename]');
        if (titleEl) {
          on(titleEl, 'dblclick', async (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const proposed = prompt('Rename file (will be saved as PDF):', f.name);
            if (!proposed) return;
            try {
              const resp = await Auth.fetch(`/api/vault/files/${f.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: proposed })
              });
              if (!resp.ok) {
                const t = await resp.text().catch(() => '');
                alert(t || 'Rename failed');
                return;
              }
              const j = await resp.json();
              f.id = j.id || f.id;
              f.name = j.name || f.name;
              f.viewUrl = j.viewUrl || f.viewUrl;
              f.downloadUrl = j.downloadUrl || f.downloadUrl;

              titleEl.textContent = f.name;
              row.dataset.id = f.id;
              await loadCatalogue();
              if (activeDocKey) renderCatalogueFiles(activeDocKey);
            } catch (e) {
              console.error(e);
              alert('Rename failed');
            }
          });
        }

        elDocumentsList.appendChild(row);
      }
    }

    await updateCollectionMetaFromFiles(currentCol.id, files);
    await maybeFallbackStatsFromCollections();
  }

  async function createCollection(name) {
    const r = await Auth.fetch('/api/vault/collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (!r.ok) {
      const t = await r.text().catch(()=> '');
      throw new Error(t || 'Failed to create collection');
    }
    const j = await r.json();
    return normalizeCollection(j.collection || j);
  }

  async function uploadFilesToCurrent(filesLike, opts = {}) {
    if (!currentCol) {
      alert('Please select a collection first.');
      return;
    }
    const files = filesLike instanceof FileList
      ? Array.from(filesLike)
      : Array.isArray(filesLike)
        ? filesLike
        : filesLike
          ? [filesLike]
          : [];
    if (!files.length) return;

    const fd = new FormData();
    const pendingRecords = [];
    for (const file of files) {
      fd.append('files', file);
      pendingRecords.push({
        id: `${Date.now()}-${Math.random()}`,
        key: opts.catalogueKey || null,
        name: file.name,
        size: file.size,
        startedAt: new Date(),
      });
    }
    if (opts.catalogueKey) fd.append('catalogueKey', opts.catalogueKey);

    pendingRecords.forEach((record) => pendingUploads.push(record));
    if (opts.catalogueKey && activeDocKey === opts.catalogueKey) {
      renderCatalogueFiles(opts.catalogueKey);
    }

    try {
      const r = await Auth.fetch(`/api/vault/collections/${currentCol.id}/files`, {
        method: 'POST',
        body: fd
      });
      if (!r.ok) {
        const t = await r.text().catch(()=> '');
        alert(t || 'Upload failed');
        return;
      }
      const tasks = [loadFiles(), loadStats(), loadCollections()];
      if (opts.catalogueKey) tasks.push(loadCatalogue());
      await Promise.all(tasks);
      await ensureMetricsAndStats();
      if (opts.catalogueKey && activeDocKey === opts.catalogueKey) {
        renderCatalogueFiles(opts.catalogueKey);
      }
    } finally {
      pendingRecords.forEach((record) => {
        const idx = pendingUploads.indexOf(record);
        if (idx !== -1) pendingUploads.splice(idx, 1);
      });
      if (opts.catalogueKey && activeDocKey === opts.catalogueKey) {
        renderCatalogueFiles(opts.catalogueKey);
      }
    }
  }

  // ---------------- Front-end fallbacks for counters ----------------
  async function recomputeAllCollectionMetrics() {
    if (!collections.length) return { totalFiles: 0, totalBytes: 0 };

    let totalFiles = 0, totalBytes = 0;

    for (const c of collections) {
      try {
        const r = await Auth.fetch(`/api/vault/collections/${c.id}/files`);
        if (!r.ok) continue;
        const j = await r.json().catch(()=> ([]));
        const files = normalizeFilesPayload(j);
        const count = files.length;
        const bytes = files.reduce((s, f) => s + (toNumber(f.size) || 0), 0);

        c.fileCount = count;
        c.bytes = bytes;

        const metaEl = elCollectionsList?.querySelector(`[data-meta-for="${CSS.escape(String(c.id))}"]`);
        if (metaEl) metaEl.textContent = `${count} files · ${fmtBytes(bytes)}`;

        totalFiles += count;
        totalBytes += bytes;
      } catch { /* ignore */ }
    }

    return { totalFiles, totalBytes };
  }

  async function maybeFallbackStatsFromCollections() {
    if (_didFallbackStats) return;
    const shownFiles = (elFileCount?.textContent || '').trim();
    if (shownFiles === '0' && collections.length) {
      const agg = await recomputeAllCollectionMetrics();
      if ((agg.totalFiles || agg.totalBytes) && elFileCount && elTotalGB) {
        updateKPIsFromStats({
          totalFiles: agg.totalFiles,
          totalBytes: agg.totalBytes,
          totalGB: +(agg.totalBytes / (1024 ** 3)).toFixed(2),
          lastUpdated: new Date().toISOString()
        });
        _didFallbackStats = true;
      }
    }
  }

  async function ensureCollectionMetrics() {
    if (_didFallbackCollectionMetrics) return;
    const allZero = collections.length > 0 && collections.every(c => !toNumber(c.fileCount) && !toNumber(c.bytes));
    if (allZero) {
      await recomputeAllCollectionMetrics();
      _didFallbackCollectionMetrics = true;
    }
  }

  async function updateCollectionMetaFromFiles(colId, filesList) {
    try {
      const files = filesList || [];
      const count = files.length;
      const bytes = files.reduce((s, f) => s + (toNumber(f.size) || 0), 0);

      const c = collections.find(x => String(x.id) === String(colId));
      if (c) { c.fileCount = count; c.bytes = bytes; }

      const metaEl = elCollectionsList?.querySelector(`[data-meta-for="${CSS.escape(String(colId))}"]`);
      if (metaEl) metaEl.textContent = `${count} files · ${fmtBytes(bytes)}`;
    } catch { /* noop */ }
  }

  async function ensureMetricsAndStats() {
    await ensureCollectionMetrics();
    await maybeFallbackStatsFromCollections();
  }

  // ---------------- Event wiring ----------------
  on(elDocFilesClose, 'click', (e) => { e.preventDefault(); closeCatalogueFiles(); });

  on(elCollectionSearch, 'input', (e) => renderCollections(e.target.value || ''));

  on(elNewCollectionBtn, 'click', () => {
    if (!elNewCollectionModal || !window.bootstrap) return;
    const modal = bootstrap.Modal.getOrCreateInstance(elNewCollectionModal);
    if (elNewCollectionName) elNewCollectionName.value = '';
    modal.show();
  });

  on(elNewCollectionForm, 'submit', async (e) => {
    e.preventDefault();
    const name = (elNewCollectionName?.value || '').trim();
    if (!name) return;
    try {
      const c = await createCollection(name);
      if (elNewCollectionModal && window.bootstrap) {
        bootstrap.Modal.getOrCreateInstance(elNewCollectionModal).hide();
      }
      await loadCollections();
      const created = collections.find(x => String(x.id) === String(c.id)) || c;
      await openCollection(created);
      await ensureMetricsAndStats();
    } catch (err) {
      alert(err.message || 'Failed to create collection');
    }
  });

  on(elBackToCollections, 'click', (e) => { e.preventDefault(); exitCollectionView(); });

  on(elFileInput, 'change', async (e) => {
    const files = e.target.files;
    await uploadFilesToCurrent(files);
    e.target.value = '';
  });

  if (elDropzone) {
    on(elDropzone, 'dragover', (e) => { e.preventDefault(); elDropzone.classList.add('dragging'); });
    on(elDropzone, 'dragleave', () => elDropzone.classList.remove('dragging'));
    on(elDropzone, 'drop', async (e) => {
      e.preventDefault();
      elDropzone.classList.remove('dragging');
      const files = e.dataTransfer?.files;
      await uploadFilesToCurrent(files);
    });
  }

  // ---------------- Init ----------------
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      await ensureAuthHelper();
      await Auth.requireAuth();
      Auth.setBannerTitle && Auth.setBannerTitle('Document Vault');

      await Promise.all([loadStats(), loadCollections(), loadCatalogue()]);
      if (elBackToCollections) elBackToCollections.classList.add('d-none');
      setPreviewSrc('about:blank');

      await ensureMetricsAndStats();
    } catch (e) {
      console.error('[document-vault] init error', e);
    }
  });
})();
