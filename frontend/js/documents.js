// frontend/js/documents.js
// Robust Documents page wiring (R2 or GridFS) with payload normalization
// and resilient modal handling to avoid aria-hidden focus warnings.

(function () {
  // ---------- DOM helpers ----------
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const on = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts);

  // ---------- Elements (with graceful fallbacks) ----------
  const elList             = $('#documents-list') || $('#docs-list') || $('#document-list');
  const elEmpty            = $('#documents-empty') || null;
  const elUploadForm       = $('#documents-upload-form') || $('#upload-form');
  const elFileInput        = $('#documents-file-input') || $('#file-input') || $('input[type="file"]');
  const elTypeSelect       = $('#doc-type') || $('#documents-type') || $('select[name="type"]');
  const elYearSelect       = $('#doc-year') || $('#documents-year') || $('select[name="year"]');
  const elProgressBar      = $('#upload-progress') || $('.progress-bar')?.[0] || null;
  const elModal            = $('#filesModal') || $('#documents-modal') || null;
  const elRefreshBtn       = $('#documents-refresh') || $('#btn-refresh') || null;

  // state
  let currentType = '';
  let currentYear = '';

  // ---------- Utilities ----------
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

  function toNumber(x) {
    if (x == null) return 0;
    if (typeof x === 'number' && isFinite(x)) return x;
    if (typeof x === 'string') {
      const n = Number(x.replace?.(/[, ]+/g, '') ?? x);
      return isFinite(n) ? n : 0;
    }
    return 0;
  }
  function pickString(...cands) {
    for (const c of cands) if (typeof c === 'string' && c.trim()) return c.trim();
    return '';
  }
  function firstNonNull(...cands) {
    for (const c of cands) if (c != null) return c;
    return undefined;
  }
  function b64urlEncode(str) {
    return btoa(unescape(encodeURIComponent(str)))
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  }
  function safeIdToPath(id) {
    // If the id already looks URL-safe, keep; else encode
    if (/^[A-Za-z0-9\-_]+$/.test(String(id))) return encodeURIComponent(id);
    return encodeURIComponent(b64urlEncode(String(id)));
  }
  function fmtBytes(bytes) {
    const b = Number(bytes || 0);
    if (b <= 0) return '0 B';
    const u = ['B','KB','MB','GB','TB','PB'];
    const i = Math.floor(Math.log(b) / Math.log(1024));
    return `${(b / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
  }
  function niceDate(d) { try { return d ? new Date(d).toLocaleString() : '—'; } catch { return '—'; } }
  function escapeHtml(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // ---------- Normalizers ----------
  function normalizeItem(it) {
    // Accept both legacy and new shapes
    const id         = pickString(it.id, it._id, it.fileId, it.key);
    const name       = pickString(it.name, it.filename, it.title, 'document');
    const size       = toNumber(firstNonNull(it.size, it.length, it.bytes, it.fileSize));
    const uploadedAt = pickString(it.uploadedAt, it.uploadDate, it.createdAt, it.timeCreated);
    const type       = pickString(it.type);
    const year       = pickString(it.year);

    // URLs: use given ones, else build from id
    let viewUrl     = pickString(it.viewUrl, it.previewUrl, it.url);
    let downloadUrl = pickString(it.downloadUrl);
    if (!viewUrl && id) viewUrl = `/api/documents/${safeIdToPath(id)}/view`;
    if (!downloadUrl && id) downloadUrl = `/api/documents/${safeIdToPath(id)}/download`;

    return { id, name, size, uploadedAt, viewUrl, downloadUrl, type, year };
  }

  function normalizeListPayload(json) {
    // Accept: array OR {documents:[...]} OR {data:[...]} OR {items:[...]}
    const raw = Array.isArray(json) ? json
      : (json?.documents || json?.items || json?.data || json?.files || []);
    return (raw || []).map(normalizeItem).filter(x => x.id);
  }

  function normalizeUploadPayload(json) {
    // Accept: {files:[...]}, {uploaded:[...]}, {documents:[...]} or array
    const raws = [];
    if (Array.isArray(json)) raws.push(...json);
    if (Array.isArray(json?.files)) raws.push(...json.files);
    if (Array.isArray(json?.uploaded)) raws.push(...json.uploaded);
    if (Array.isArray(json?.documents)) raws.push(...json.documents);
    return raws.map(normalizeItem).filter(x => x.id);
  }

  // ---------- Render ----------
  function renderList(items) {
    if (!elList) return;
    elList.innerHTML = '';

    if (!items.length) {
      if (elEmpty) elEmpty.classList.remove('d-none');
      return;
    }
    if (elEmpty) elEmpty.classList.add('d-none');

    for (const f of items) {
      const row = document.createElement('div');
      row.className = 'doc-row d-flex justify-content-between align-items-center';
      row.dataset.id = f.id;

      row.innerHTML = `
        <div class="d-flex align-items-center gap-2 min-w-0">
          <i class="bi bi-file-earmark-text text-primary"></i>
          <div class="min-w-0">
            <div class="text-truncate">${escapeHtml(f.name)}</div>
            <div class="text-muted small">${fmtBytes(f.size)} · ${niceDate(f.uploadedAt)}</div>
          </div>
        </div>
        <div class="d-flex align-items-center gap-1 flex-shrink-0">
          <button class="btn btn-sm btn-light border" data-action="preview" title="Preview"><i class="bi bi-eye"></i></button>
          <button class="btn btn-sm btn-light border" data-action="download" title="Download"><i class="bi bi-download"></i></button>
          <button class="btn btn-sm btn-light border text-danger" data-action="delete" title="Delete"><i class="bi bi-trash"></i></button>
        </div>
      `;

      const btnPrev = row.querySelector('[data-action="preview"]');
      const btnDown = row.querySelector('[data-action="download"]');
      const btnDel  = row.querySelector('[data-action="delete"]');

      on(btnPrev, 'click', async () => {
        if (!f.viewUrl) return alert('No preview URL available.');
        try {
          const r = await Auth.fetch(f.viewUrl);
          if (!r.ok) { const t = await r.text().catch(()=> ''); alert(t || 'Preview failed'); return; }
          const blob = await r.blob();
          const url = URL.createObjectURL(blob);
          // Use a shared iframe if present
          const iframe = $('#documents-preview-frame') || $('#preview-frame');
          const label  = $('#documents-preview-filename') || $('#preview-filename');
          if (iframe) {
            iframe.src = url;
            iframe.classList.remove('d-none');
          } else {
            // fallback open new tab
            window.open(url, '_blank', 'noopener');
          }
          if (label) label.textContent = f.name || '';
        } catch (e) {
          console.error(e); alert('Preview failed');
        }
      });

      on(btnDown, 'click', async () => {
        if (!f.downloadUrl) return alert('No download URL available.');
        try {
          const r = await Auth.fetch(f.downloadUrl);
          if (!r.ok) { const t = await r.text().catch(()=> ''); alert(t || 'Download failed'); return; }
          const blob = await r.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = (f.name || 'document').replace(/[\\/:*?"<>|]+/g, '_');
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1500);
        } catch (e) {
          console.error(e); alert('Download failed');
        }
      });

      on(btnDel, 'click', async () => {
        if (!confirm('Delete this document?')) return;
        try {
          // Prefer explicit DELETE URL if given; else build from id
          const delUrl = `/api/documents/${safeIdToPath(f.id)}`;
          const r = await Auth.fetch(delUrl, { method: 'DELETE' });
          if (!r.ok) { const t = await r.text().catch(()=> ''); alert(t || 'Delete failed'); return; }
          await loadList(); // refresh
        } catch (e) {
          console.error(e); alert('Delete failed');
        }
      });

      elList.appendChild(row);
    }
  }

  // ---------- API ----------
  function currentQuery() {
    const t = (elTypeSelect?.value || '').trim();
    const y = (elYearSelect?.value || '').trim();
    currentType = t;
    currentYear = y;
    const params = new URLSearchParams();
    if (t) params.set('type', t);
    if (y) params.set('year', y);
    return params.toString() ? `?${params}` : '';
  }

  async function loadList() {
    const q = currentQuery();
    const r = await Auth.fetch(`/api/documents${q}`);
    if (!r.ok) {
      if (elList) elList.innerHTML = '<div class="text-muted small p-2">Failed to load documents.</div>';
      return;
    }
    const j = await r.json().catch(() => ([]));
    const items = normalizeListPayload(j);
    renderList(items);
  }

  async function uploadFiles(files) {
    if (!files || !files.length) return;

    const fd = new FormData();
    // The legacy UI sometimes uses `file` and sometimes `files[]`; support both
    let usedLegacySingleField = false;
    if (files.length === 1) {
      fd.append('file', files[0]);
      usedLegacySingleField = true;
    }
    for (const f of files) fd.append('files', f);

    const q = currentQuery();
    // Progress (best effort): fetch() doesn’t give upload progress; keep the bar animated if present
    if (elProgressBar) {
      elProgressBar.style.width = '5%';
      elProgressBar.ariaValueNow = '5';
      elProgressBar.classList.add('progress-bar-striped', 'progress-bar-animated');
    }

    const resp = await Auth.fetch(`/api/documents${q}`, { method: 'POST', body: fd });
    if (!resp.ok) {
      const t = await resp.text().catch(()=> '');
      if (elProgressBar) {
        elProgressBar.style.width = '0%';
        elProgressBar.classList.remove('progress-bar-striped', 'progress-bar-animated');
      }
      alert(t || 'Upload failed');
      return;
    }
    const j = await resp.json().catch(()=> ({}));
    const added = normalizeUploadPayload(j);

    // progress complete
    if (elProgressBar) {
      elProgressBar.style.width = '100%';
      elProgressBar.ariaValueNow = '100';
      setTimeout(() => {
        elProgressBar.style.width = '0%';
        elProgressBar.classList.remove('progress-bar-striped', 'progress-bar-animated');
      }, 500);
    }

    // Close modal safely, avoiding aria-hidden focus issue
    if (elModal && window.bootstrap) {
      try {
        // blur any focused element inside the modal
        const active = document.activeElement;
        if (active && elModal.contains(active)) active.blur();
        const modal = bootstrap.Modal.getOrCreateInstance(elModal);
        const onHidden = () => {
          elModal.removeEventListener('hidden.bs.modal', onHidden);
          // focus back to list after closing
          try { elList?.focus(); } catch {}
        };
        elModal.addEventListener('hidden.bs.modal', onHidden);
        modal.hide();
      } catch {}
    }

    // If the server gave us items, optimistically render them at the top
    if (added.length) {
      // Fetch an authoritative list so counters & server-side filters are consistent
      await loadList();
    } else {
      // Even if POST body was weird, still refresh
      await loadList();
    }

    // Clear file input value to allow re-upload of same file name
    if (elFileInput) elFileInput.value = '';
  }

  // ---------- Events ----------
  on(elTypeSelect, 'change', () => loadList());
  on(elYearSelect, 'change', () => loadList());
  on(elRefreshBtn, 'click', (e) => { e.preventDefault(); loadList(); });

  if (elUploadForm) {
    on(elUploadForm, 'submit', async (e) => {
      e.preventDefault();
      const files = elFileInput?.files;
      if (!files || !files.length) { alert('Please choose a file.'); return; }
      await uploadFiles(files);
    });
  }

  if (elFileInput) {
    on(elFileInput, 'change', async (e) => {
      const files = e.target.files;
      if (!files || !files.length) return;
      // Some UIs submit on change; support both submit and change flows
      if (!elUploadForm) await uploadFiles(files);
    });
  }

  // ---------- Init ----------
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      await ensureAuthHelper();
      await Auth.requireAuth();
      // Seed filters (if selects have defaults)
      currentQuery();
      await loadList();
    } catch (e) {
      console.error('[documents] init error', e);
    }
  });
})();

