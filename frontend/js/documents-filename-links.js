// frontend/js/documents-filename-links.js
// 1) Ensures each document row has data attributes for id & filename
// 2) Turns the filename into a clickable link
// 3) On click: preview PDFs in a modal <iframe>; otherwise auto-download

(function () {
    // ---- Modal (one per page)
    let modal, iframe, spinner, currentBlobUrl = null;
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
  
    async function openOrDownload(id, filename) {
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
        console.error('[documents] preview/download error:', e);
        // Optional: toast UI
      }
    }
  
    // Make a filename cell clickable
    function linkifyCell(cell, id, filename) {
      if (!cell || !id) return;
      // If already linkified, just bind handler
      let a = cell.querySelector('a.doc-filename-link');
      if (!a) {
        a = document.createElement('a');
        a.className = 'doc-filename-link';
        a.href = '#';
        a.textContent = filename || (cell.textContent || '').trim() || 'view';
        // Replace cell content with link (preserve width/layout)
        while (cell.firstChild) cell.removeChild(cell.firstChild);
        cell.appendChild(a);
      }
      a.addEventListener('click', (e) => { e.preventDefault(); openOrDownload(id, filename); });
      a.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openOrDownload(id, filename); }
      });
    }
  
    // Tries hard to get id/filename from attributes; if missing, falls back to text
    function upgradeRows() {
      // Any element representing a doc row/card
      const rows = document.querySelectorAll('[data-doc-id], [data-file-id], [data-id], .document-row, .doc-row, .file-row, tr');
      rows.forEach((row) => {
        const id = row.getAttribute?.('data-doc-id') || row.getAttribute?.('data-file-id') || row.getAttribute?.('data-id');
        // Find filename area
        const nameEl =
          row.querySelector?.('[data-filename]') ||
          row.querySelector?.('.doc-filename, .filename, .name, .title') ||
          row.querySelector?.('td:first-child, .cell, .column');
        const filename = (nameEl?.getAttribute?.('data-filename') || nameEl?.textContent || '').trim();
  
        if (!nameEl) return; // nothing to turn into a link
        if (!id) {
          // As a safety, attach a data-doc-id to the row if the filename text contains an id nearby
          // (Leave it if we can't determine — just skip)
          return;
        }
        linkifyCell(nameEl, id, filename);
      });
    }
  
    function init() {
      ensureModal();
      upgradeRows();
  
      // If your list re-renders, observe and re-apply
      const mo = new MutationObserver((muts) => {
        for (const m of muts) {
          if (m.addedNodes && m.addedNodes.length) { upgradeRows(); break; }
        }
      });
      mo.observe(document.body, { childList: true, subtree: true });
  
      // Also expose a hook you can call after your own render completes:
      window.DocumentsLinkify = { refresh: upgradeRows };
    }
  
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  })();
  