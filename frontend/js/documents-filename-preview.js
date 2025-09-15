// frontend/js/documents-filename-preview.js
// Turns document filenames into links that preview PDFs in a modal iframe,
// and auto-download non-PDF files. Non-destructive: it wraps/uses existing text.

(function () {
    if (!window.Auth) {
      console.warn('[filename-preview] Auth helper not found. Include frontend/js/auth.js first.');
    }
  
    // --- Minimal styles for the modal
    const style = document.createElement('style');
    style.textContent = `
      .doc-prev-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: none; z-index: 1000; }
      .doc-prev-modal { position: absolute; inset: 5%; background: #111; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.4); display: flex; flex-direction: column; }
      .doc-prev-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: #1a1a1a; border-bottom: 1px solid rgba(255,255,255,0.08); color: #fff; }
      .doc-prev-title { font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .doc-prev-close { border: 0; background: transparent; cursor: pointer; color: #fff; font-size: 18px; line-height: 1; }
      .doc-prev-body { position: relative; flex: 1; }
      .doc-prev-iframe { width: 100%; height: 100%; border: 0; background: #222; }
      .doc-prev-spinner { position: absolute; inset: 0; display: grid; place-items: center; font-size: 13px; color: #eee; }
      .doc-prev-backdrop.show { display: block; }
      .doc-filename-link { text-decoration: underline; cursor: pointer; }
    `;
    document.head.appendChild(style);
  
    // --- Modal singleton
    let modal, iframe, spinner, currentBlobUrl = null;
    function ensureModal() {
      if (modal) return modal;
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
      const closeBtn = modal.querySelector('.doc-prev-close');
  
      function close() {
        modal.classList.remove('show');
        if (currentBlobUrl) { URL.revokeObjectURL(currentBlobUrl); currentBlobUrl = null; }
        iframe.src = 'about:blank';
      }
      modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
      closeBtn.addEventListener('click', close);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.classList.contains('show')) close(); });
  
      return modal;
    }
  
    // --- Utilities
    function findRow(el) {
      return el.closest?.('[data-doc-id], [data-file-id], [data-id], .document-row, .doc-row, .file-row, tr, li, .card') || el;
    }
    function extractDocId(el) {
      const row = findRow(el);
      if (!row) return null;
      return row.getAttribute?.('data-doc-id')
          || row.getAttribute?.('data-file-id')
          || row.getAttribute?.('data-id')
          || null;
    }
    function extractFilename(el) {
      // Prefer explicit filename carriers inside the row; else fall back to link text
      const row = findRow(el);
      const nameEl = row?.querySelector?.('[data-filename], .doc-filename, .filename, .name, .title, td:first-child');
      const fromAttr = nameEl?.getAttribute?.('data-filename');
      const text = (fromAttr || nameEl?.textContent || '').trim();
      if (text) return text;
      return (el.textContent || '').trim() || 'download';
    }
  
    async function openOrDownloadById(id, filename) {
      ensureModal();
      try {
        const res = await (window.Auth ? Auth.fetch(`/api/documents/${encodeURIComponent(id)}/stream`) : fetch(`/api/documents/${encodeURIComponent(id)}/stream`));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ct = (res.headers.get('Content-Type') || '').toLowerCase();
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
  
        // PDF → preview in modal iframe
        if (ct.includes('pdf')) {
          currentBlobUrl = url;
          spinner.style.display = 'grid';
          document.getElementById('doc-prev-title').textContent = filename ? `Preview — ${filename}` : 'Preview';
          modal.classList.add('show');
          iframe.src = url;
          setTimeout(() => { spinner.style.display = 'none'; }, 150);
          return;
        }
  
        // Non-PDF → auto download
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || 'download';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error('[filename-preview] Failed to fetch/preview:', err);
        // Optional: toast/UI message if you have a system
      }
    }
  
    // Wrap filename text in an <a> and bind the click handler (id stays on row)
    function linkifyFilenameCell(cell) {
      if (!cell) return;
      // If it’s already a link we just attach handler
      const existingLink = cell.querySelector('a.doc-filename-link, a[href="#"], a[href="javascript:void(0)"]');
      const id = extractDocId(cell);
      if (!id) return;
  
      const filename = extractFilename(cell);
  
      const bind = (anchor) => {
        anchor.classList.add('doc-filename-link');
        anchor.setAttribute('role', 'link');
        anchor.setAttribute('href', '#');
        anchor.setAttribute('tabindex', '0');
        anchor.addEventListener('click', (e) => { e.preventDefault(); openOrDownloadById(id, filename); });
        anchor.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openOrDownloadById(id, filename); } });
      };
  
      if (existingLink) {
        bind(existingLink);
        return;
      }
  
      // Create a link and wrap the existing contents
      const a = document.createElement('a');
      a.textContent = filename || (cell.textContent || '').trim() || 'view';
      bind(a);
  
      // Replace cell content with the link, preserving layout
      while (cell.firstChild) cell.removeChild(cell.firstChild);
      cell.appendChild(a);
    }
  
    // Find filename cells/areas in typical table/card layouts
    function linkifyAll() {
      // Priority: any explicit filename markers
      const explicit = document.querySelectorAll('[data-filename], .doc-filename, .filename, .name, .title');
      explicit.forEach(linkifyFilenameCell);
  
      // Fallback: first cell in each row that has a doc id
      const rows = document.querySelectorAll('[data-doc-id], [data-file-id], [data-id], .document-row, .doc-row, .file-row, tr');
      rows.forEach((row) => {
        const id = extractDocId(row);
        if (!id) return;
        const firstCell = row.querySelector?.('td, .cell, .column, .doc-name, .file-name');
        if (firstCell && !firstCell.querySelector('.doc-filename-link')) {
          linkifyFilenameCell(firstCell);
        }
      });
    }
  
    function init() {
      ensureModal();
      linkifyAll();
  
      // Observe dynamic list updates and re-apply
      const mo = new MutationObserver((muts) => {
        for (const m of muts) {
          if (m.addedNodes && m.addedNodes.length) {
            linkifyAll();
            break;
          }
        }
      });
      mo.observe(document.body, { childList: true, subtree: true });
  
      // Safety: delegate clicks for any future links
      document.addEventListener('click', (e) => {
        const a = e.target.closest('.doc-filename-link');
        if (!a) return;
        e.preventDefault();
        const id = extractDocId(a);
        if (!id) return;
        const filename = extractFilename(a);
        openOrDownloadById(id, filename);
      });
    }
  
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  })();
  