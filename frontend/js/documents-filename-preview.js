// frontend/js/documents-filename-preview.js
// Single-source-of-truth handler: clicking a .doc-filename-link
// previews PDFs in a modal iframe, or downloads other types.
// Idempotent: installs once, no per-link listeners, no re-binding.

(function () {
    if (window.__DOC_FILENAME_PREVIEW_INSTALLED__) return;
    window.__DOC_FILENAME_PREVIEW_INSTALLED__ = true;
  
    // ---- Modal (one per page)
    let modal, iframe, spinner, currentBlobUrl = null, opening = false;
  
    function ensureModal() {
      if (modal) return modal;
  
      const style = document.createElement('style');
      style.textContent = `
        .doc-prev-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display:none; z-index:1000; }
        .doc-prev-modal { position:absolute; inset:5%; background:#111; border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,.4); display:flex; flex-direction:column; }
        .doc-prev-header { display:flex; align-items:center; justify-content:space-between; padding:10px 14px; background:#1a1a1a; border-bottom:1px solid rgba(255,255,255,.08); color:#fff; }
        .doc-prev-title { font-weight:600; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .doc-prev-close { border:0; background:transparent; cursor:pointer; color:#fff; font-size:18px; line-height:1; }
        .doc-prev-body { position:relative; flex:1; }
        .doc-prev-iframe { width:100%; height:100%; border:0; background:#222; }
        .doc-prev-spinner { position:absolute; inset:0; display:grid; place-items:center; font-size:13px; color:#eee; }
        .doc-prev-backdrop.show { display:block; }
        a.doc-filename-link { text-decoration: underline; cursor: pointer; }
      `;
      document.head.appendChild(style);
  
      modal = document.createElement('div');
      modal.className = 'doc-prev-backdrop';
      modal.innerHTML = `
        <div class="doc-prev-modal" role="dialog" aria-modal="true" aria-label="Document preview">
          <div class="doc-prev-header">
            <div class="doc-prev-title" id="doc-prev-title">Preview</div>
            <button class="doc-prev-close" title="Close" aria-label="Close">&times;</button>
          </div>
          <div class="doc-prev-body">
            <div class="doc-prev-spinner" id="doc-prev-spinner">Loading preview…</div>
            <iframe class="doc-prev-iframe" id="doc-prev-iframe" referrerpolicy="no-referrer"></iframe>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
  
      iframe  = modal.querySelector('#doc-prev-iframe');
      spinner = modal.querySelector('#doc-prev-spinner');
  
      function close() {
        modal.classList.remove('show');
        if (currentBlobUrl) { URL.revokeObjectURL(currentBlobUrl); currentBlobUrl = null; }
        iframe.src = 'about:blank';
      }
      modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
      modal.querySelector('.doc-prev-close').addEventListener('click', close);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.classList.contains('show')) close(); });
  
      return modal;
    }
  
    async function openOrDownload(id, filename) {
      if (!id || opening) return;
      opening = true;
      ensureModal();
  
      try {
        const res = await (window.Auth ? Auth.fetch(`/api/documents/${encodeURIComponent(id)}/stream`) : fetch(`/api/documents/${encodeURIComponent(id)}/stream`));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ct = (res.headers.get('Content-Type') || '').toLowerCase();
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
  
        if (ct.includes('pdf')) {
          currentBlobUrl = url;
          spinner.style.display = 'grid';
          document.getElementById('doc-prev-title').textContent = filename ? `Preview — ${filename}` : 'Preview';
          modal.classList.add('show');
          iframe.src = url;
          setTimeout(() => { spinner.style.display = 'none'; }, 120);
        } else {
          const a = document.createElement('a');
          a.href = url;
          a.download = filename || 'download';
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
        }
      } catch (e) {
        console.error('[filename-preview] preview/download error:', e);
      } finally {
        // brief guard so double-bound handlers in other scripts can’t race
        setTimeout(() => { opening = false; }, 150);
      }
    }
  
    function findRow(el) {
      return el.closest?.('[data-doc-id], [data-file-id], [data-id], .document-row, .doc-row, .file-row, tr, li, .card') || el;
    }
  
    // Single delegated listener (no per-link binds anywhere)
    document.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('a.doc-filename-link');
      if (!a) return;
      e.preventDefault();
  
      const row = findRow(a);
      const id =
        a.getAttribute('data-doc-id') ||
        row?.getAttribute?.('data-doc-id') ||
        row?.getAttribute?.('data-file-id') ||
        row?.getAttribute?.('data-id');
  
      const filename =
        a.getAttribute('data-filename') ||
        row?.querySelector?.('[data-filename]')?.getAttribute?.('data-filename') ||
        (a.textContent || '').trim();
  
      openOrDownload(id, filename);
    });
  })();
  