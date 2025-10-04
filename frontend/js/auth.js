// frontend/js/auth.js
(function () {
  // Keep compatibility with legacy token keys already in your app.
  const STORAGE_KEYS = ['token', 'jwt', 'authToken'];
  const USER_CACHE_KEY = 'me';

  // ---------- Token helpers ----------
  function getToken() {
    for (const k of STORAGE_KEYS) {
      const v = localStorage.getItem(k) || sessionStorage.getItem(k);
      if (v) return v;
    }
    return null;
  }
  function setToken(token, { session = false } = {}) {
    clearTokens();
    (session ? sessionStorage : localStorage).setItem('token', token || '');
  }
  function clearTokens() {
    for (const k of STORAGE_KEYS) {
      try { localStorage.removeItem(k); } catch {}
      try { sessionStorage.removeItem(k); } catch {}
    }
    try { localStorage.removeItem(USER_CACHE_KEY); } catch {}
    try { sessionStorage.removeItem(USER_CACHE_KEY); } catch {}
    window.__ME__ = null;
  }

  // ---------- JWT decode & basic expiry check ----------
  function decodeJWT(t) {
    try {
      const b64 = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(atob(b64).split('').map(c => {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      return JSON.parse(json);
    } catch {
      return null;
    }
  }
  function isExpired(token) {
    const payload = decodeJWT(token);
    if (!payload || !payload.exp) return false; // if no exp, don't assume expired
    const nowSec = Math.floor(Date.now() / 1000);
    // Add a tiny skew to avoid edge flicker
    return payload.exp <= (nowSec + 5);
  }

  // ---------- Fetch wrapper that adds Authorization when possible ----------
  async function fetchWithAuth(url, options = {}) {
    const token = getToken();
    const headers = new Headers(options.headers || {});
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(window.API ? window.API.url(url) : url, { ...options, headers });
  }

  // ---------- Tolerant user load (keeps your current behaviour) ----------
  // Used by dashboard etc. We don't hard-fail UI here.
  async function loadUser(force = false) {
    if (!force && window.__ME__) return window.__ME__;
    const cached = (() => {
      try { return JSON.parse(localStorage.getItem(USER_CACHE_KEY) || sessionStorage.getItem(USER_CACHE_KEY) || 'null'); } catch {
        return null;
      }
    })();
    if (!force && cached) {
      window.__ME__ = cached;
      return cached;
    }

    const t = getToken();
    if (!t) return null;
    try {
      const res = await fetch((window.API ? window.API.url('/api/user/me') : '/api/user/me'), {
        headers: { Authorization: `Bearer ${t}` },
        cache: 'no-store'
      });
      if (!res.ok) return null;
      const me = await res.json();
      window.__ME__ = me;
      try { localStorage.setItem(USER_CACHE_KEY, JSON.stringify(me)); } catch {}
      return me;
    } catch {
      return null;
    }
  }

  async function requireAuth() {
    const t = getToken();
    try {
      const me = await loadUser(true) || { firstName: 'Guest' };
      window.__ME__ = me;
      const g = document.getElementById('greeting-name');
      if (g && me?.firstName) g.textContent = me.firstName;
      return { me, token: t };
    } catch {
      const me = { firstName: 'Guest' };
      window.__ME__ = me;
      return { me, token: t };
    }
  }

  // ---------- Strict gate for protected pages ----------
  // Pages already call:
  //   Auth.enforce();                                 // protected pages
  //   Auth.enforce({ allowAnonymous:[...], bounceIfAuthed:true }); // login/signup
  async function enforce(opts = {}) {
    const defaults = {
      allowAnonymous: ['index.html', 'login.html', 'signup.html', '404.html', 'unauthorized.html'],
      bounceIfAuthed: false,   // on login/signup: if already authed, go to next/home
      validateWithServer: true // actually hit /api/user/me when a token exists
    };
    const cfg = { ...defaults, ...opts };

    // Current page filename, e.g. "home.html"
    const page = (() => {
      const p = (location.pathname || '/').split('/').pop();
      return p && p.includes('.') ? p : 'index.html';
    })();

    const hasToken = !!getToken();
    const token = getToken();
    const looksValid = hasToken && !isExpired(token);

    // Helper: redirect to login with ?next=<current>
    function toLogin() {
      const next = encodeURIComponent(location.pathname + location.search);
      location.replace(`./login.html?next=${next}`);
    }
    // Helper: redirect to app home or provided next
    function toAppHomeFromLogin() {
      const params = new URLSearchParams(location.search);
      const next = params.get('next');
      location.replace(next && next.startsWith('/') ? next : './home.html');
    }

    // Anonymous pages (login/signup/index/etc.)
    if (cfg.allowAnonymous.includes(page)) {
      if (!cfg.bounceIfAuthed) return;
      // If we're on login/signup and already authenticated, bounce to app.
      if (!hasToken) return;                      // clearly not authed
      if (!looksValid && !cfg.validateWithServer) return; // unsure, let them log in

      if (cfg.validateWithServer) {
        try {
          const res = await fetchWithAuth('/api/user/me', { cache: 'no-store' });
          if (res.ok) return toAppHomeFromLogin(); // definitely authed
        } catch { /* ignore and let page load */ }
        return; // couldn't confirm; allow login page
      } else {
        return toAppHomeFromLogin();
      }
    }

    // Protected pages (everything else)
    if (!hasToken) return toLogin();
    if (isExpired(token)) { clearTokens(); return toLogin(); }

    if (cfg.validateWithServer) {
      try {
        const res = await fetchWithAuth('/api/user/me', { cache: 'no-store' });
        if (!res.ok) { clearTokens(); return toLogin(); }
        // Cache user for the page (and keep existing tolerant flow intact)
        try {
          const me = await res.json();
          window.__ME__ = me;
          try { localStorage.setItem(USER_CACHE_KEY, JSON.stringify(me)); } catch {}
        } catch { /* ignore parse errors; tolerant */ }
      } catch {
        // Network error => safest is to require re-auth
        return toLogin();
      }
    }

    // Keep your current pattern: pages often call requireAuth() after this
    return;
  }

  // ---------- Optional nicety used by your pages ----------
  function setBannerTitle(suffix) {
    const name = (window.__ME__?.firstName || '').trim();
    const title = name ? `${name} — ${suffix}` : suffix;
    document.title = title;
    const h = document.querySelector('h1.page-title, h1');
    if (h && !h.dataset.lockTitle) h.textContent = title;
    const g = document.getElementById('greeting-name');
    if (g && name) g.textContent = name;
  }

  function signOut() {
    clearTokens();
    location.href = './login.html';
  }

  async function getCurrentUser({ force = false } = {}) {
    const me = await loadUser(force);
    return me;
  }

  // Public API (names preserved)
  window.Auth = {
    getToken, setToken, clearTokens,
    requireAuth,
    fetch: fetchWithAuth,
    enforce,
    setBannerTitle,
    signOut,
    getCurrentUser,
    get me() { return window.__ME__; }
  };
})();
