// frontend/js/config.js
(function () {
    const explicit = (window.__API_BASE || localStorage.getItem('API_BASE') || '').trim();
    const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
  
    // In dev, default to hitting the backend on :3000 even if page is on another port.
    const DEV_BACKEND = 'http://localhost:3000';
    const base = explicit ||
                 (isLocal ? (location.port === '3000' ? location.origin : DEV_BACKEND)
                          : location.origin);
  
    window.API = {
      BASE: base,
      url: (path) => /^https?:\/\//i.test(path)
        ? path
        : base + (path.startsWith('/') ? path : '/' + path),
      fetch: (path, options = {}) => fetch(window.API.url(path), options)
    };
  
    console.log('[config] API.BASE =', window.API.BASE);
  })();
  