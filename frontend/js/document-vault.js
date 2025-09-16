// frontend/js/document-vault.js
(function () {
    const $  = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  
    const mFiles   = $('#m-files');
    const mStorage = $('#m-storage');
    const mUpdated = $('#m-updated');
  
    const colWrap  = $('#collections');
    const colEmpty = $('#collections-empty');
    const btnNewCol= $('#btn-new-col');
  
    const panel    = $('#panel');
    const btnBack  = $('#btn-back');
    const panelName= $('#panel-name');
    const fileList = $('#file-list');
    const preview  = $('#preview-frame');
  
    const dropzone = $('#dropzone');
    const fileInput= $('#file-input');
  
    let collections = [];
    let currentCol = null;
  
    function fmtBytes(n) {
      n = Number(n || 0);
      if (n < 1024) return `${n} B`;
      const kb = n / 1024, mb = kb / 1024, gb = mb / 1024;
      if (gb >= 1) return `${gb.toFixed(2)} GB`;
      if (mb >= 1) return `${mb.toFixed(2)} MB`;
      return `${kb.toFixed(1)} KB`;
    }
    function niceDate(d) { return d ? new Date(d).toLocaleString() : '—'; }
  
    async function loadStats() {
      const r = await Auth.fetch('/api/vault/stats');
      if (!r.ok) return;
      const s = await r.json();
      mFiles.textContent   = s.totalFiles ?? 0;
      mStorage.textContent = s.totalGB != null && s.totalGB > 0 ? `${s.totalGB} GB` : fmtBytes(s.totalBytes || 0);
      mUpdated.textContent = niceDate(s.lastUpdated);
    }
  
    async function loadCollections() {
      const r = await Auth.fetch('/api/vault/collections');
      if (!r.ok) { colWrap.innerHTML = '<div class="text-muted small">Failed to load.</div>'; return; }
      const j = await r.json();
      collections = j.collections || [];
      renderCollections();
    }
  
    function renderCollections() {
      colWrap.innerHTML = '';
      colEmpty.style.display = collections.length ? 'none' : '';
      for (const c of collections) {
        const card = document.createElement('div');
        card.className = 'col-card';
        card.innerHTML = `
          <div class="hd">
            <div class="name">${c.name}</div>
            <div class="meta">${c.fileCount || 0} files · ${fmtBytes(c.bytes || 0)}</div>
          </div>
        `;
        card.addEventListener('click', () => openCollection(c));
        colWrap.appendChild(card);
      }
    }
  
    async function createCollectionFlow() {
      const name = prompt('New collection name');
      if (!name) return;
      const r = await Auth.fetch('/api/vault/collections', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      if (!r.ok) { const t = await r.text(); alert(t || 'Create failed'); return; }
      await loadCollections();
    }
  
    async function openCollection(c) {
      currentCol = c;
      panelName.textContent = c.name;
      panel.classList.add('show');
      $('#collections-section').style.display = 'none';
      await loadFiles();
    }
  
    function closePanel() {
      currentCol = null;
      panel.classList.remove('show');
      $('#collections-section').style.display = '';
      preview.src = 'about:blank';
    }
  
    async function loadFiles() {
      if (!currentCol) return;
      const r = await Auth.fetch(`/api/vault/collections/${currentCol.id}/files`);
      if (!r.ok) { fileList.innerHTML = '<div class="text-muted small">Failed to load files.</div>'; return; }
      const j = await r.json();
      const files = j.files || [];
      fileList.innerHTML = '';
      if (!files.length) fileList.innerHTML = '<div class="text-muted small">No files yet.</div>';
      for (const f of files) {
        const row = document.createElement('div');
        row.className = 'file-item';
        row.innerHTML = `
          <div>
            <div class="fw-semibold">${f.name}</div>
            <div class="meta">${fmtBytes(f.size)} · ${niceDate(f.uploadedAt)}</div>
          </div>
          <div class="btn-group">
            <a class="btn btn-sm btn-outline-primary" href="${f.downloadUrl}" title="Download">Download</a>
            <button class="btn btn-sm btn-outline-secondary" data-view>Preview</button>
            <button class="btn btn-sm btn-outline-danger" data-del>Delete</button>
          </div>
        `;
        row.querySelector('[data-view]').addEventListener('click', () => {
          preview.src = f.viewUrl;
          preview.focus();
        });
        row.querySelector('[data-del]').addEventListener('click', async () => {
          if (!confirm('Delete this file?')) return;
          const r = await Auth.fetch(`/api/vault/files/${f.id}`, { method: 'DELETE' });
          if (!r.ok) { const t = await r.text(); alert(t || 'Delete failed'); return; }
          await loadFiles();
          await loadStats();
          await loadCollections();
        });
        fileList.appendChild(row);
      }
    }
  
    // Upload handling
    function setDzActive(on) { dropzone.classList.toggle('drag', !!on); }
  
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); setDzActive(true); });
    dropzone.addEventListener('dragleave', () => setDzActive(false));
    dropzone.addEventListener('drop', async (e) => {
      e.preventDefault(); setDzActive(false);
      const files = Array.from(e.dataTransfer.files || []).filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
      if (!files.length) return alert('Only PDF files are allowed.');
      await doUpload(files);
    });
  
    dropzone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      await doUpload(files);
      fileInput.value = '';
    });
  
    async function doUpload(files) {
      if (!currentCol) return;
      const fd = new FormData();
      for (const f of files.slice(0, 20)) fd.append('files', f, f.name);
      const r = await Auth.fetch(`/api/vault/collections/${currentCol.id}/files`, { method: 'POST', body: fd });
      if (!r.ok) { const t = await r.text(); alert(t || 'Upload failed'); return; }
      await loadFiles();
      await loadStats();
      await loadCollections();
    }
  
    // wiring
    btnNewCol.addEventListener('click', createCollectionFlow);
    btnBack.addEventListener('click', closePanel);
  
    document.addEventListener('DOMContentLoaded', async () => {
      try {
        await Auth.requireAuth();
        Auth.setBannerTitle('Document Vault');
        await loadStats();
        await loadCollections();
      } catch (e) {
        console.error(e);
      }
    });
  })();
  