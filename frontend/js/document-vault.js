// frontend/js/document-vault.js
// Document Vault wiring with robust payload normalization for stats/collections,
// and Option B upload (no programmatic .click()) to avoid double-open dialogs.

(function () {
    // ---------------- DOM helpers ----------------
    const $  = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
    const on = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts);
  
    // ---------------- Elements (new IDs first, then legacy fallbacks) ----------------
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
  
    // Upload / Dropzone (Option B — label/input handles picker)
    const elDropzone  = $('#dropzone');
    const elFileInput = $('#file-input');
  
    // Preview area
    const elPreviewFrame = $('#preview-frame');
    const elPreviewEmpty = $('#preview-empty');
    const elPreviewFilename = $('#preview-filename');
  
    // Sections
    const elCollectionsSection = $('#collections-section') || $('#collections'); // legacy toggle
  
    // State
    let collections = [];
    let currentCol = null;
  
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
    function escapeHtml(s) {
      return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }
    function fmtBytes(bytes) {
      const b = Number(bytes || 0);
      if (b <= 0) return '0 B';
      const u = ['B','KB','MB','GB','TB','PB'];
      const i = Math.floor(Math.log(b) / Math.log(1024));
      return `${(b / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
    }
    function niceDate(d) { return d ? new Date(d).toLocaleString() : '—'; }
  
    // Normalize server payloads with many possible shapes
    function normalizeStats(s) {
      if (!s || typeof s !== 'object') return { totalFiles: 0, totalBytes: 0, totalGB: 0 };
      // common variants seen across APIs
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
      return { id, name, fileCount, bytes, _raw: c };
    }
  
    function normalizeFilesPayload(j) {
      const list = Array.isArray(j) ? j : (j?.files || j?.items || j?.data || []);
      return list.map(f => ({
        id: pickString(f.id, f._id, f.fileId, String(f.id ?? '')),
        name: pickString(f.name, f.filename, f.title, 'document'),
        size: pickNumber(f.size, f.bytes, f.length, f.fileSize),
        uploadedAt: pickString(f.uploadedAt, f.createdAt, f.timeCreated, f.timestamp),
        viewUrl: pickString(f.viewUrl, f.previewUrl, f.url, f.href),
        downloadUrl: pickString(f.downloadUrl, f.url, f.href)
      }));
    }
  
    // Load auth helper if page forgot to include it
    async function ensureAuthHelper() {
      if (window.Auth) return;
      await new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = '/js/auth.js';
        s.onload = resolve;
        s.onerror = resolve; // continue even if it fails (will error later cleanly)
        document.head.appendChild(s);
      });
    }
  
    function updateKPIsFromStats(statsRaw) {
      const stats = normalizeStats(statsRaw);
      if (elFileCount) elFileCount.textContent = stats.totalFiles ?? 0;
  
      if (elTotalGB) {
        // Prefer explicit totalGB if returned, otherwise format bytes nicely
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
  
    // ---------------- API ----------------
    async function loadStats() {
      const r = await Auth.fetch('/api/vault/stats');
      if (!r.ok) return;
      const s = await r.json().catch(()=> ({}));
      updateKPIsFromStats(s);
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
        const row = document.createElement('a');
        row.href = '#';
        row.className = 'collection-item';
        row.dataset.id = c.id;
        row.innerHTML = `
          <div class="collection-name"><i class="bi bi-folder2 me-2 text-primary"></i>${escapeHtml(c.name)}</div>
          <div class="collection-meta">${(c.fileCount || 0)} files · ${fmtBytes(c.bytes || 0)}</div>
        `;
        on(row, 'click', (e) => { e.preventDefault(); openCollection(c); });
        elCollectionsList.appendChild(row);
      }
    }
  
    async function openCollection(col) {
      currentCol = col;
      if (elCurrentCollectionName) elCurrentCollectionName.textContent = col?.name || 'All documents';
      if (elBackToCollections) elBackToCollections.classList.remove('d-none');
      // For legacy layout that hid collections when inside panel:
      if (elCollectionsSection && elCollectionsSection.id === 'collections-section') {
        elCollectionsSection.style.display = 'none';
      }
      await loadFiles();
    }
  
    function exitCollectionView() {
      currentCol = null;
      if (elCurrentCollectionName) elCurrentCollectionName.textContent = 'All documents';
      if (elBackToCollections) elBackToCollections.classList.add('d-none');
      setPreviewSrc('about:blank');
      if (elDocumentsList) elDocumentsList.innerHTML = '';
      // Show legacy section again
      if (elCollectionsSection && elCollectionsSection.id === 'collections-section') {
        elCollectionsSection.style.display = '';
      }
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
        return;
      }
  
      for (const f of files) {
        const row = document.createElement('div');
        row.className = 'doc-row';
        row.dataset.id = f.id;
  
        row.innerHTML = `
          <div class="doc-main">
            <i class="bi bi-file-earmark-text text-primary"></i>
            <div class="min-w-0">
              <div class="doc-title" data-filename>${escapeHtml(f.name)}</div>
              <div class="doc-sub">${fmtBytes(f.size)} · ${niceDate(f.uploadedAt)}</div>
            </div>
          </div>
          <div class="doc-actions">
            <button class="btn btn-icon" data-action="preview" title="Preview"><i class="bi bi-eye"></i></button>
            <button class="btn btn-icon" data-action="download" title="Download"><i class="bi bi-download"></i></button>
            <button class="btn btn-icon text-danger" data-action="delete" title="Delete"><i class="bi bi-trash"></i></button>
          </div>
        `;
  
        on(row.querySelector('[data-action="preview"]'), 'click', () => {
          const url = f.viewUrl || f.downloadUrl; // fall back if no viewUrl
          if (!url) return alert('No preview URL available.');
          previewFile(url, f.name);
        });
        on(row.querySelector('[data-action="download"]'), 'click', () => {
          const url = f.downloadUrl || f.viewUrl;
          if (!url) return alert('No download URL available.');
          downloadFile(url, f.name);
        });
        on(row.querySelector('[data-action="delete"]'), 'click', async () => {
          if (!confirm('Delete this file?')) return;
          const del = await Auth.fetch(`/api/vault/files/${f.id}`, { method: 'DELETE' });
          if (!del.ok) { const t = await del.text().catch(()=> ''); alert(t || 'Delete failed'); return; }
          await Promise.all([loadFiles(), loadStats(), loadCollections()]);
          setPreviewSrc('about:blank');
        });
  
        elDocumentsList.appendChild(row);
      }
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
      // Return normalized object
      return normalizeCollection(j.collection || j);
    }
  
    async function uploadFilesToCurrent(files) {
      if (!currentCol) {
        alert('Please select a collection first.');
        return;
      }
      if (!files || !files.length) return;
  
      const fd = new FormData();
      for (const file of files) fd.append('files', file);
  
      const r = await Auth.fetch(`/api/vault/collections/${currentCol.id}/files`, {
        method: 'POST',
        body: fd
      });
      if (!r.ok) {
        const t = await r.text().catch(()=> '');
        alert(t || 'Upload failed');
        return;
      }
      await Promise.all([loadFiles(), loadStats(), loadCollections()]);
    }
  
    // ---------------- Event wiring ----------------
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
      } catch (err) {
        alert(err.message || 'Failed to create collection');
      }
    });
  
    // Back link (legacy)
    on(elBackToCollections, 'click', (e) => { e.preventDefault(); exitCollectionView(); });
  
    // File input change → upload (Option B: NO programmatic .click())
    on(elFileInput, 'change', async (e) => {
      const files = e.target.files;
      await uploadFilesToCurrent(files);
      e.target.value = ''; // allow re-upload of same-named file
    });
  
    // Drag & drop uploads supported
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
        await Promise.all([loadStats(), loadCollections()]);
        if (elBackToCollections) elBackToCollections.classList.add('d-none');
        setPreviewSrc('about:blank');
      } catch (e) {
        console.error('[document-vault] init error', e);
      }
    });
  })();
  