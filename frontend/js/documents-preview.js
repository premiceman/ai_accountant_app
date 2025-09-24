// frontend/js/documents-preview.js
// Adds a "Preview" action for PDFs in the Documents tile.
// Minimal DOM assumptions. If your selectors differ, tweak SELECTORS below.

(function () {
    if (!window.Auth) {
      console.warn('[documents-preview] Auth helper not found. Include frontend/js/auth.js first.');
    }
  
    // --- Config: adjust these if your DOM differs
    const SELECTORS = {
      // A container that holds document rows/cards
      listContainers: ['.documents-list', '.documents-table', '.documents-tile', '#documents', '.tile-documents'],
      // Where action buttons live (we try several)
      actionAreas: ['.doc-actions', '.actions', '.row-actions', '.document-actions'],
      // Existing delete button selector (used to find where to inject preview button)
      deleteBtn: '.btn-delete, [data-action="delete"]',
      // Row attribute that stores the document id (we’ll scan a few)
      rowIdAttrs: ['data-doc-id', 'data-id', 'data-file-id'],
    };
  
    // SVG eye icon (fallback). If you have an "icon-view" class, we prefer that.
    const EYE_ICON_SVG = `
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 5c-7 0-11 7-11 7s4 7 11 7 11-7 11-7-4-7-11-7zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10z"/>
      </svg>`.trim();
  
    // Inject a lightweight modal (created once)
    let modal, iframe, spinner, closeBtn, currentBlobUrl = null;
  
    function ensureModal() {
      if (modal) return modal;
      const style = document.createElement('style');
      style.textContent = `
        .doc-prev-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: none; z-index: 1000; }
        .doc-prev-modal { position: absolute; inset: 5%; background: #111; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.4); display: flex; flex-direction: column; }
        .doc-prev-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: #1a1a1a; border-bottom: 1px solid rgba(255,255,255,0.08); color: #fff; }
        .doc-prev-title { font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .doc-prev-close { border: 0; background: transparent; cursor: pointer; color: #fff; font-size: 16px; line-height: 1; }
        .doc-prev-body { position: relative; flex: 1; }
        .doc-prev-iframe { width: 100%; height: 100%; border: 0; background: #222; }
        .doc-prev-spinner { position: absolute; inset: 0; display: grid; place-items: center; font-size: 13px; color: #eee; }
        .doc-prev-backdrop.show { display: block; }
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
  
      iframe = modal.querySelector('#doc-prev-iframe');
      spinner = modal.querySelector('#doc-prev-spinner');
      closeBtn = modal.querySelector('.doc-prev-close');
  
      function close() {
        modal.classList.remove('show');
        if (currentBlobUrl) {
          URL.revokeObjectURL(currentBlobUrl);
          currentBlobUrl = null;
        }
        iframe.src = 'about:blank';
      }
      modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
      closeBtn.addEventListener('click', close);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.classList.contains('show')) close(); });
  
      return modal;
    }
  
    // Utility: find a document id on a row or its children
    function extractDocId(el) {
      if (!el) return null;
      // Walk up to a row element
      let row = el.closest('[data-doc-id], [data-id], [data-file-id], tr, li, .card, .document-row');
      for (let i = 0; i < 4 && row && !row.dataset; i++) row = row.parentElement;
      if (row && row.dataset) {
        for (const attr of SELECTORS.rowIdAttrs) {
          if (row.getAttribute && row.getAttribute(attr)) return row.getAttribute(attr);
          if (row.dataset && row.dataset[attr.replace('data-', '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())]) {
            return row.dataset[attr.replace('data-', '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())];
          }
        }
      }
      // Fallback: button might carry it
      const btnId = el.getAttribute('data-doc-id') || el.getAttribute('data-id') || el.getAttribute('data-file-id');
      return btnId || null;
    }
  
    async function openPreview({ id, filename }) {
      ensureModal();
      spinner.style.display = 'grid';
      document.getElementById('doc-prev-title').textContent = filename ? `Preview — ${filename}` : 'Preview';
      modal.classList.add('show');
  
      try {
        const res = await (window.Auth ? Auth.fetch(`/api/documents/${encodeURIComponent(id)}/stream`) : fetch(`/api/documents/${encodeURIComponent(id)}/stream`));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ct = res.headers.get('Content-Type') || '';
        if (!ct.includes('pdf')) {
          spinner.innerHTML = `This file isn't a PDF. <a href="#" id="doc-prev-download">Download</a>`;
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const dl = document.getElementById('doc-prev-download');
          dl.addEventListener('click', (e) => { e.preventDefault(); window.open(url, '_blank', 'noopener'); });
          currentBlobUrl = url;
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        currentBlobUrl = url;
        iframe.src = url;
      } catch (err) {
        console.error('[documents-preview] preview error:', err);
        spinner.textContent = 'Failed to load preview.';
      } finally {
        // Let the iframe paint; then hide spinner
        setTimeout(() => { spinner.style.display = 'none'; }, 150);
      }
    }
  
    function makePreviewButton(id, filename) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-icon btn-preview';
      btn.type = 'button';
      btn.title = 'Preview';
      btn.setAttribute('data-action', 'preview');
      btn.setAttribute('data-doc-id', id);
      // Prefer your icon class if present
      if (document.querySelector('.icon.icon-view')) {
        const i = document.createElement('span');
        i.className = 'icon icon-view';
        btn.appendChild(i);
      } else {
        btn.innerHTML = EYE_ICON_SVG;
      }
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        openPreview({ id, filename });
      });
      return btn;
    }
  
    function injectButtons() {
      // Find rows via delete buttons (reliable anchor) and inject preview next to them
      const deleteBtns = document.querySelectorAll(SELECTORS.deleteBtn);
      deleteBtns.forEach((delBtn) => {
        // Skip if a preview button already exists next to it
        const container = delBtn.parentElement;
        if (!container) return;
        const already = container.querySelector('.btn-preview, [data-action="preview"]');
        if (already) return;
  
        const id = extractDocId(delBtn);
        if (!id) return;
  
        // Try to derive filename from text in the row
        let filename = '';
        const row = delBtn.closest('tr, li, .card, .document-row') || delBtn.parentElement;
        if (row) {
          const nameEl = row.querySelector('[data-filename], .doc-filename, .name, .filename, td:first-child, .title');
          filename = nameEl ? (nameEl.getAttribute('data-filename') || nameEl.textContent || '').trim() : '';
        }
  
        const previewBtn = makePreviewButton(id, filename);
        container.insertBefore(previewBtn, delBtn); // Put preview before delete
      });
    }
  
    function init() {
      ensureModal();
      injectButtons();
  
      // If your list re-renders dynamically, re-apply after updates:
      const root = document.querySelector(SELECTORS.listContainers.join(', ')) || document.body;
      const mo = new MutationObserver((muts) => {
        for (const m of muts) {
          if (m.addedNodes && m.addedNodes.length) {
            injectButtons();
            break;
          }
        }
      });
      mo.observe(root, { childList: true, subtree: true });
  
      // Delegate clicks for any future buttons
      document.addEventListener('click', (e) => {
        const t = e.target.closest('.btn-preview, [data-action="preview"]');
        if (!t) return;
        e.preventDefault();
        const id = extractDocId(t);
        if (!id) return;
        const row = t.closest('tr, li, .card, .document-row') || t.parentElement;
        const nameEl = row ? (row.querySelector('[data-filename], .doc-filename, .name, .filename, td:first-child, .title')) : null;
        const filename = nameEl ? (nameEl.getAttribute('data-filename') || nameEl.textContent || '').trim() : '';
        openPreview({ id, filename });
      });
    }
  
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  })();
  