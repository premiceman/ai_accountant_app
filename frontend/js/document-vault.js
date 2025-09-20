// frontend/js/document-vault.js
// Document Vault — now supports dual backends:
//  - NEW: Cloudflare R2 flow (/api/r2/*)
//  - Legacy: existing Vault endpoints (/api/vault/*)
// We try R2 first for listing, then fall back to legacy. Uploads go to R2.

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
    let _didFallbackStats = false;
    let _didFallbackCollectionMetrics = false;
  
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
  
    // Normalize server payloads (legacy)
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
      return { id, name, fileCount, bytes, _raw: c };
    }
  
    function normalizeFilesPayload(j, { source = 'legacy' } = {}) {
      const list = Array.isArray(j) ? j : (j?.files || j?.items || j?.data || []);
      return list.map(f => ({
        id: pickString(f.id, f._id, f.fileId, String(f.id ?? '')),
        name: pickString(f.name, f.filename, f.title, 'document'),
        size: pickNumber(f.size, f.bytes, f.length, f.fileSize),
        uploadedAt: pickString(f.uploadedAt, f.createdAt, f.timeCreated, f.timestamp),
        viewUrl: pickString(f.viewUrl, f.previewUrl, f.url, f.href),
        downloadUrl: pickString(f.downloadUrl, f.url, f.href),
        source,             // 'legacy' | 'r2'
        r2DocId: f.r2DocId  // present on R2 responses
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
  
    // ---------------- R2 helpers ----------------
    async function r2GetPresignedUrl(docId) {
      const r = await Auth.fetch(`/api/r2/${docId}/preview`);
      if (!r.ok) throw new Error(await r.text().catch(()=> 'Presign failed'));
      const j = await r.json().catch(()=> ({}));
      if (!j.url) throw new Error('No URL in presign response');
      return j.url;
    }
  
    async function r2ListFiles(collectionId) {
      // If you haven’t added this backend route yet, this will 404 and we’ll silently fall back to legacy.
      const r = await Auth.fetch(`/api/r2/collections/${collectionId}/files`);
      if (!r.ok) throw new Error('R2 list not available');
      const j = await r.json().catch(()=> ([]));
      // Expecting [{ id, name, size, uploadedAt, r2DocId }]
      return normalizeFilesPayload(j, { source: 'r2' });
    }
  
    async function r2DeleteFile(docId) {
      const r = await Auth.fetch(`/api/r2/files/${docId}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(await r.text().catch(()=> 'Delete failed'));
      return true;
    }
  
    // ---------------- Preview / Download ----------------
    async function previewFileSmart(f) {
      try {
        if (f.source === 'r2' && f.r2DocId) {
          const url = await r2GetPresignedUrl(f.r2DocId);
          // Direct view of presigned URL (no Auth headers)
          setPreviewSrc(url, f.name);
          return;
        }
        const url = f.viewUrl || f.downloadUrl;
        if (!url) return alert('No preview URL available.');
        const r = await Auth.fetch(url);
        if (!r.ok) { const t = await r.text().catch(()=> ''); alert(t || 'Preview failed'); return; }
        const blob = await r.blob();
        setPreviewSrc(URL.createObjectURL(blob), f.name);
      } catch (e) {
        console.error(e);
        alert('Preview failed.');
      }
    }
  
    async function downloadFileSmart(f) {
      try {
        if (f.source === 'r2' && f.r2DocId) {
          const url = await r2GetPresignedUrl(f.r2DocId);
          // We can just link to the presigned URL; the browser will download/preview
          const a = document.createElement('a');
          a.href = url;
          a.download = (f.name || 'document.pdf').replace(/[\\/:*?"<>|]+/g, '_');
          document.body.appendChild(a);
          a.click();
          a.remove();
          return;
        }
        const url = f.downloadUrl || f.viewUrl;
        if (!url) return alert('No download URL available.');
        const r = await Auth.fetch(url);
        if (!r.ok) { const t = await r.text().catch(()=> ''); alert(t || 'Download failed'); return; }
        const blob = await r.blob();
        const obj = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = obj;
        a.download = (f.name || 'document.pdf').replace(/[\\/:*?"<>|]+/g, '_');
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(obj), 1000);
      } catch (e) {
        console.error(e);
        alert('Download failed.');
      }
    }
  
    // ---------------- API ----------------
    async function loadStats() {
      // Legacy stats endpoint; we also compute client-side fallbacks later.
      const r = await Auth.fetch('/api/vault/stats');
      if (!r.ok) return;
      const s = await r.json().catch(()=> ({}));
      updateKPIsFromStats(s);
    }
  
    async function loadCollections() {
      // Legacy collections endpoint; new storage still uses the same collections.
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
          <div class="collection-meta" data-meta-for="${escapeHtml(c.id)}">
            ${(c.fileCount || 0)} files · ${fmtBytes(c.bytes || 0)}
          </div>
        `;
        on(row, 'click', (e) => { e.preventDefault(); openCollection(c); });
        elCollectionsList.appendChild(row);
      }
    }
  
    async function openCollection(col) {
      currentCol = col;
      if (elCurrentCollectionName) elCurrentCollectionName.textContent = col?.name || 'All documents';
      if (elBackToCollections) elBackToCollections.classList.remove('d-none');
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
      if (elCollectionsSection && elCollectionsSection.id === 'collections-section') {
        elCollectionsSection.style.display = '';
      }
    }
  
    async function loadFiles() {
      if (!currentCol || !elDocumentsList) return;
      elDocumentsList.innerHTML = '<div class="text-muted small p-2">Loading…</div>';
  
      let files = [];
      let usedR2 = false;
  
      // Try NEW R2 listing first
      try {
        const r2Files = await r2ListFiles(currentCol.id);
        if (Array.isArray(r2Files) && r2Files.length) {
          files = files.concat(r2Files);
          usedR2 = true;
        }
      } catch {
        // No R2 listing yet — ignore
      }
  
      // Also try legacy listing (to show older uploads)
      try {
        const r = await Auth.fetch(`/api/vault/collections/${currentCol.id}/files`);
        if (r.ok) {
          const j = await r.json().catch(()=> ([]));
          const legacy = normalizeFilesPayload(j, { source: 'legacy' });
          files = files.concat(legacy);
        }
      } catch {
        // ignore
      }
  
      // If neither worked:
      if (!files.length) {
        elDocumentsList.innerHTML = '<div class="text-muted small p-2">No files in this collection.</div>';
      } else {
        // Render
        elDocumentsList.innerHTML = '';
        for (const f of files) {
          const row = document.createElement('div');
          row.className = 'doc-row';
          row.dataset.id = f.id;
  
          const srcBadge = f.source === 'r2' ? `<span class="badge bg-light text-dark ms-2">R2</span>` : '';
          row.innerHTML = `
            <div class="doc-main">
              <i class="bi bi-file-earmark-text text-primary"></i>
              <div class="min-w-0">
                <div class="doc-title" data-filename>
                  ${escapeHtml(f.name)} ${srcBadge}
                </div>
                <div class="doc-sub">${fmtBytes(f.size)} · ${niceDate(f.uploadedAt)}</div>
              </div>
            </div>
            <div class="doc-actions">
              <button class="btn btn-icon" data-action="preview" title="Preview"><i class="bi bi-eye"></i></button>
              <button class="btn btn-icon" data-action="download" title="Download"><i class="bi bi-download"></i></button>
              <button class="btn btn-icon text-danger" data-action="delete" title="Delete"><i class="bi bi-trash"></i></button>
            </div>
          `;
  
          on(row.querySelector('[data-action="preview"]'), 'click', () => previewFileSmart(f));
          on(row.querySelector('[data-action="download"]'), 'click', () => downloadFileSmart(f));
          on(row.querySelector('[data-action="delete"]'), 'click', async () => {
            if (!confirm('Delete this file?')) return;
            try {
              if (f.source === 'r2' && f.r2DocId) {
                await r2DeleteFile(f.r2DocId);
              } else {
                const del = await Auth.fetch(`/api/vault/files/${f.id}`, { method: 'DELETE' });
                if (!del.ok) throw new Error(await del.text().catch(()=> 'Delete failed'));
              }
              await Promise.all([loadFiles(), loadStats(), loadCollections()]);
              await ensureMetricsAndStats();
              setPreviewSrc('about:blank');
            } catch (e) {
              console.error(e);
              alert(e.message || 'Delete failed');
            }
          });
  
          elDocumentsList.appendChild(row);
        }
      }
  
      // Update KPIs/meta using whatever we were able to load
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
  
    // ------------- NEW UPLOAD (R2 presign → PUT → commit) -------------
    async function uploadFilesToCurrent(files) {
      if (!currentCol) {
        alert('Please select a collection first.');
        return;
      }
      if (!files || !files.length) return;
  
      for (const file of files) {
        try {
          // Optional: quick client-side type filter to PDFs for v1
          // if (file.type !== 'application/pdf') { alert(`${file.name}: Only PDFs supported in v1`); continue; }
  
          // 1) presign
          const presign = await Auth.fetch(`/api/r2/presign`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              filename: file.name,
              mime: file.type || 'application/octet-stream',
              size: file.size,
              typeHint: guessTypeHint(file.name),
              collectionId: currentCol.id
            })
          }).then(r => r.json());
  
          if (!presign?.putUrl || !presign?.docId) throw new Error('Presign failed');
  
          // 2) PUT to R2 directly (no Auth headers)
          await fetch(presign.putUrl, {
            method: "PUT",
            body: file,
            headers: { "content-type": file.type || 'application/octet-stream' }
          });
  
          // 3) commit (enqueue pipeline)
          await Auth.fetch(`/api/r2/${presign.docId}/commit`, { method: "POST" });
        } catch (e) {
          console.error('Upload failed', e);
          alert(`${file?.name || 'file'}: upload failed`);
        }
      }
  
      await Promise.all([loadFiles(), loadStats(), loadCollections()]);
      await ensureMetricsAndStats();
    }
  
    function guessTypeHint(name) {
      const n = (name || '').toLowerCase();
      if (n.includes('payslip')) return 'payslip';
      if (n.includes('statement')) return 'bank_statement';
      if (n.includes('passport')) return 'passport';
      if (n.includes('p60')) return 'P60';
      if (n.includes('invoice')) return 'invoice';
      if (n.includes('utility')) return 'utility_bill';
      return 'other';
    }
  
    // ---------------- Front-end fallbacks for counters ----------------
  
    async function recomputeAllCollectionMetrics() {
      if (!collections.length) return { totalFiles: 0, totalBytes: 0 };
  
      let totalFiles = 0;
      let totalBytes = 0;
  
      for (const c of collections) {
        try {
          // Prefer R2 listing if available
          let files = [];
          try {
            files = await r2ListFiles(c.id);
          } catch {
            // ignore and try legacy
          }
  
          if (!files.length) {
            const r = await Auth.fetch(`/api/vault/collections/${c.id}/files`);
            if (r.ok) {
              const j = await r.json().catch(()=> ([]));
              files = normalizeFilesPayload(j, { source: 'legacy' });
            }
          }
  
          const count = files.length;
          const bytes = files.reduce((s, f) => s + (toNumber(f.size) || 0), 0);
  
          // Persist into state
          c.fileCount = count;
          c.bytes = bytes;
  
          // Update visible meta row
          const metaEl = elCollectionsList?.querySelector(`[data-meta-for="${CSS.escape(String(c.id))}"]`);
          if (metaEl) metaEl.textContent = `${count} files · ${fmtBytes(bytes)}`;
  
          totalFiles += count;
          totalBytes += bytes;
        } catch {
          // ignore
        }
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
  
        const metaEl = elCollectionsList?.querySelector(
          `[data-meta-for="${CSS.escape(String(colId))}"]`
        );
        if (metaEl) metaEl.textContent = `${count} files · ${fmtBytes(bytes)}`;
      } catch { /* noop */ }
    }
  
    async function ensureMetricsAndStats() {
      await ensureCollectionMetrics();
      await maybeFallbackStatsFromCollections();
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
        await ensureMetricsAndStats();
      } catch (err) {
        alert(err.message || 'Failed to create collection');
      }
    });
  
    on(elBackToCollections, 'click', (e) => { e.preventDefault(); exitCollectionView(); });
  
    on(elFileInput, 'change', async (e) => {
      const files = e.target.files;
      await uploadFilesToCurrent(files);
      e.target.value = ''; // allow re-upload of same-named file
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
  
        await Promise.all([loadStats(), loadCollections()]);
        if (elBackToCollections) elBackToCollections.classList.add('d-none');
        setPreviewSrc('about:blank');
  
        await ensureMetricsAndStats();
      } catch (e) {
        console.error('[document-vault] init error', e);
      }
    });
  })();
  
  
  