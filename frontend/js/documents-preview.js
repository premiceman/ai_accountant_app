// frontend/js/documents-preview.js
// Lightweight helper used by some older templates; safe to include alongside documents.js

(function () {
  const $  = (s, r = document) => r.querySelector(s);
  const on = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts);

  const iframe = $('#documents-preview-frame') || $('#preview-frame');
  const label  = $('#documents-preview-filename') || $('#preview-filename');

  // If a page uses data-preview-url on rows, support it:
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest?.('[data-preview-url][data-filename]');
    if (!btn) return;
    e.preventDefault();
    const url  = btn.getAttribute('data-preview-url');
    const name = btn.getAttribute('data-filename') || 'document';
    try {
      const r = await Auth.fetch(url);
      if (!r.ok) { const t = await r.text().catch(()=> ''); alert(t || 'Preview failed'); return; }
      const blob = await r.blob();
      const obj = URL.createObjectURL(blob);
      if (iframe) {
        iframe.src = obj;
        iframe.classList.remove('d-none');
      } else {
        window.open(obj, '_blank', 'noopener');
      }
      if (label) label.textContent = name;
    } catch (err) {
      console.error(err); alert('Preview failed');
    }
  }, true);
})();
