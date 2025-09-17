// frontend/js/document-vault.js
// Wires up the "Document Vault" page to the /api/vault backend without changing aesthetics.
// Compatible with the current document-vault.html IDs and gracefully falls back to older ones.

(function () {
    // ---------------- DOM helpers ----------------
    const $  = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
    const on = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts);
  
    // ---------------- Elements (new IDs first, then legacy fallbacks) ----------------
    // KPIs
    const elFileCount = $('#file-count') || $('#m-files');
    const elTotalGB   = $('#total-gb')   || $('#m-storage');
    const elUpdated   = $('#m-updated'); // optional (not present in new HTML)
  
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
    const elBrowseBtn = $('#btn-browse'); // legacy (not present in new HTML)
  
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
    function escapeHtml(s) {
      return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }
    function fmtBytes(bytes) {
      const b = Number(bytes || 0);
      if (b <= 0) return '0 B';
      const u = ['B','KB','MB','GB','TB'];
      const i = Math.floor(Math.log(b) / Math.log(1024));
      return `${(b / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
    }
    function niceDate(d) { return d ? new Date(d).toLocaleString() : '—'; }
  
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
  
    function updateKPIsFromStats(stats) {
      if (elFileCount) elFileCount.textContent = stats?.totalFiles ?? 0;
      if (elTotalGB) {
        if (typeof stats?.totalGB === 'number' && stats.totalGB >= 0) {
          elTotalGB.textContent = `${stats.totalGB} GB`;
        } else {
          elTotalGB.textContent = fmtBytes(stats?.totalBytes || 0);
        }
      }
      if (elUpdated) elUpdated.textContent = niceDate(stats?.lastUpdated);
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
      const s = await r.json();
      updateKPIsFromStats(s);
    }
  
    async function loadCollections() {
      const r = await Auth.fetch('/api/vault/collections');
      if (!r.ok) {
        if (elCollectionsList) elCollectionsList.innerHTML = '<div class="text-muted small">Failed to load collections.</div>';
        return;
      }
      const j = await r.json();
      collections = j.collections || [];
      renderCollections();
      if (elCollectionCount) elCollectionCount.textContent = String(collections.length);
    }
  
    function renderCollections(filterText = '') {
      if (!elCollectionsList) return;
      elCollectionsList.innerHTML = '';
      const q = filterText.trim().toLowerCase();
  
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
      const j = await r.json();
      const files = j.files || [];
  
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
  
        on(row.querySelector('[data-action="preview"]'), 'click', () => previewFile(f.viewUrl, f.name));
        on(row.querySelector('[data-action="download"]'), 'click', () => downloadFile(f.downloadUrl, f.name));
        on(row.querySelector('[data-action="delete"]'), 'click', async () => {
          if (!confirm('Delete this file?')) return;
          const del = await Auth.fetch(`/api/vault/files/${f.id}`, { method: 'DELETE' });
          if (!del.ok) { const t = await del.text().catch(()=> ''); alert(t || 'Delete failed'); return; }
          // Refresh files + stats + collection list
          await Promise.all([loadFiles(), loadStats(), loadCollections()]);
          // Clear preview if it was open for this file
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
      return j.collection;
    }
  
    async function uploadFilesToCurrent(files) {
      if (!currentCol) {
        alert('Please select a collection first.');
        return;
      }
      if (!files || !files.length) return;
  
      const fd = new FormData();
      // Support multi-file uploads: append same field name "files"
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
        // Close modal
        if (elNewCollectionModal && window.bootstrap) {
          bootstrap.Modal.getOrCreateInstance(elNewCollectionModal).hide();
        }
        // Refresh and open the new collection
        await loadCollections();
        const created = collections.find(x => String(x.id) === String(c.id)) || c;
        await openCollection(created);
      } catch (err) {
        alert(err.message || 'Failed to create collection');
      }
    });
  
    // Back link
    on(elBackToCollections, 'click', (e) => { e.preventDefault(); exitCollectionView(); });
  
    // File input change → upload (Option B: NO programmatic clicks anywhere)
    on(elFileInput, 'change', async (e) => {
      const files = e.target.files;
      await uploadFilesToCurrent(files);
      // Clear file input so same name can be uploaded again
      e.target.value = '';
    });
  
    // ❌ Removed: Legacy browse button programmatic click (avoids double-open)
    // on(elBrowseBtn, 'click', () => elFileInput && elFileInput.click());
  
    // ❌ Removed: Dropzone click → fileInput.click() (avoids double-open)
    // on(elDropzone, 'click', (e) => {
    //   const clickable = e.target.closest('.dz-clickable-area') || e.target === elDropzone;
    //   if (clickable && elFileInput) elFileInput.click();
    // });
  
    // Drag & drop uploads still supported
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
        // Hide back link initially
        if (elBackToCollections) elBackToCollections.classList.add('d-none');
        // Ensure preview starts empty
        setPreviewSrc('about:blank');
      } catch (e) {
        console.error('[document-vault] init error', e);
      }
    });
  })();
