// frontend/js/head-include.js
// Injects common <head> assets (CSS, icons, scripts) on every page with one line.
// Put <script src="/js/head-include.js"></script> as the FIRST tag inside <head>.

(function injectHead() {
    const HEAD = document.head;
  
    function addMeta(attr, value, id) {
      if (id && document.getElementById(id)) return;
      const m = document.createElement('meta');
      if (id) m.id = id;
      // attr can be "name" or "charset"
      if (attr === 'charset') {
        // charset ideally belongs at the top of HTML; skip if already present
        if (document.querySelector('meta[charset]')) return;
        m.setAttribute('charset', value);
      } else {
        m.setAttribute('name', attr);
        m.setAttribute('content', value);
      }
      HEAD.prepend(m); // best-effort
    }
  
    function addLink(id, rel, href, attrs = {}) {
      if (document.getElementById(id)) return;
      const el = document.createElement('link');
      el.id = id;
      el.rel = rel;
      el.href = href;
      Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
      // Put CSS early in <head> to minimize FOUC
      const firstScript = HEAD.querySelector('script');
      if (firstScript) HEAD.insertBefore(el, firstScript); else HEAD.appendChild(el);
    }
  
    function addScript(id, src, attrs = {}) {
      if (document.getElementById(id)) return;
      const s = document.createElement('script');
      s.id = id;
      s.src = src;
      Object.entries(attrs).forEach(([k, v]) => s.setAttribute(k, v));
      HEAD.appendChild(s);
    }
  
    // ---- Meta (optional, safe to centralize) ----
    addMeta('charset', 'utf-8', 'meta-charset');
    addMeta('viewport', 'width=device-width, initial-scale=1', 'meta-viewport');
  
    // ---- CSS (CDNs + your app stylesheet) ----
    addLink(
      'css-bootstrap',
      'stylesheet',
      'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css'
    );
    addLink(
      'css-bootstrap-icons',
      'stylesheet',
      'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css'
    );
    // Bump the ?v= number whenever you update styles to bust cache
    addLink('css-app-styles', 'stylesheet', '/css/styles.css?v=3');
  
    // ---- JS libraries (deferred so they don’t block rendering) ----
    addScript(
      'js-bootstrap',
      'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js',
      { defer: 'defer', crossorigin: 'anonymous' }
    );
    addScript(
      'js-chartjs',
      'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
      { defer: 'defer' }
    );
  
    // Optional: expose a hook to know assets were injected
    window.__HEAD_INCLUDED__ = true;
  })();
  