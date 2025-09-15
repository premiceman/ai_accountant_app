(function () {
  const head = document.head;

  function add(tag, attrs) {
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([k,v]) => el.setAttribute(k, v));
    head.appendChild(el);
  }

  // Bootstrap & Icons
  add('link', { rel: 'stylesheet', href: 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css' });
  add('link', { rel: 'stylesheet', href: 'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css' });

  // Global styles
  add('link', { rel: 'stylesheet', href: '/css/styles.css' });

  // Chart.js
  add('script', { src: 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js' });

  // Bootstrap Bundle
  add('script', { src: 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js' });
})();
