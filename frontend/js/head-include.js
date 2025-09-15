// /frontend/js/head-include.js
(function () {
  const d = document, h = d.head;
  const add = (tag, attrs) => {
    const existing = attrs.id && d.getElementById(attrs.id);
    if (existing) return existing;
    const el = d.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => (el[k] = v));
    h.appendChild(el);
    return el;
  };

  add('link', { id:'bs-css', rel:'stylesheet',
    href:'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css' });
  add('link', { id:'bi-css', rel:'stylesheet',
    href:'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css' });
  add('link', { id:'site-css', rel:'stylesheet', href:'/css/styles.css' });
  add('script', { id:'bs-js',
    src:'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js', defer:true });

  // Same-origin default (since we serve frontend from API in Option A)
  if (!window.__API_BASE) {
    const meta = d.querySelector('meta[name="api-base"]');
    window.__API_BASE = meta?.content || location.origin;
  }
})();

