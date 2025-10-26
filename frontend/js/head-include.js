(function () {
  const head = document.head;
  const doc = document.documentElement;
  const THEME_STORAGE_KEY = 'phloat-theme';

  function getStoredTheme() {
    try {
      return localStorage.getItem(THEME_STORAGE_KEY);
    } catch (err) {
      return null;
    }
  }

  const prefersDark = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const storedTheme = getStoredTheme();
  const existingTheme = (doc.getAttribute('data-theme') || '').toLowerCase();
  const initialTheme = storedTheme || (existingTheme === 'dark' ? 'dark' : existingTheme === 'light' ? 'light' : (prefersDark ? 'dark' : 'light'));
  const normalizedTheme = initialTheme === 'dark' ? 'dark' : 'light';
  doc.setAttribute('data-theme', normalizedTheme);
  doc.classList.toggle('theme-dark', normalizedTheme === 'dark');
  doc.style.colorScheme = normalizedTheme === 'dark' ? 'dark' : 'light';

  function add(tag, attrs) {
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (v === '') {
        el.setAttribute(k, '');
      } else {
        el.setAttribute(k, v);
      }
    });
    head.appendChild(el);
    return el;
  }

  function ensureLink(rel, href, extraAttrs = {}) {
    const selector = `link[rel="${rel}"][href="${href}"]`;
    if (document.head.querySelector(selector)) return;
    const el = add('link', { rel, href, ...extraAttrs });
    if ('fetchpriority' in extraAttrs || 'fetchPriority' in extraAttrs) {
      el.fetchPriority = extraAttrs.fetchPriority || extraAttrs.fetchpriority || 'auto';
    }
  }

  function loadStylesheetFast(href) {
    const existingSheet = document.head.querySelector(`link[rel="stylesheet"][href="${href}"]`);
    if (existingSheet) {
      existingSheet.setAttribute('fetchpriority', existingSheet.getAttribute('fetchpriority') || 'high');
      return;
    }

    const supportsPreload = (() => {
      const link = document.createElement('link');
      return !!(link.relList && link.relList.supports && link.relList.supports('preload'));
    })();

    if (!supportsPreload) {
      ensureLink('stylesheet', href, { fetchpriority: 'high' });
      return;
    }

    const preload = add('link', {
      rel: 'preload',
      as: 'style',
      href,
      fetchpriority: 'high'
    });
    preload.fetchPriority = 'high';

    preload.onload = function () {
      this.onload = null;
      this.rel = 'stylesheet';
    };

    requestAnimationFrame(() => {
      if (!document.head.querySelector(`link[rel="stylesheet"][href="${href}"]`)) {
        ensureLink('stylesheet', href, { fetchpriority: 'high' });
        const fallbackLink = document.head.querySelector(`link[rel="stylesheet"][href="${href}"]`);
        if (fallbackLink) fallbackLink.fetchPriority = 'high';
      }
    });
  }

  // Establish early connections for CDN assets
  add('link', { rel: 'preconnect', href: 'https://cdn.jsdelivr.net', crossorigin: '' });
  add('link', { rel: 'dns-prefetch', href: 'https://cdn.jsdelivr.net' });

  // Bootstrap & Icons
  ensureLink('stylesheet', 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css');
  ensureLink('stylesheet', 'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css');

  // Global styles with high priority loading
  loadStylesheetFast('/css/styles.css');

  // Theme orchestrator
  add('script', { src: '/js/theme.js', defer: '' });

  // Chart.js
  add('script', { src: 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js' });

  // Bootstrap Bundle
  add('script', { src: 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js' });
})();
