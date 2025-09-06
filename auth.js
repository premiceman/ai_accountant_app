// frontend/js/auth.js
(function () {
  // We read/write "token" by default but also accept legacy keys for compatibility.
  const STORAGE_KEYS = ['token', 'jwt', 'authToken'];
  const USER_CACHE_KEY = 'me';

  // ---- Token helpers ----
  function getToken() {
    for (const k of STORAGE_KEYS) {
      const v = localStorage.getItem(k) || sessionStorage.getItem(k);
      if (v) return v;
    }
    return null;
  }
  function setToken(token, { session = false } = {}) {
    // Clear old keys then set canonical "token"
    clearTokens();
    (session ? sessionStorage : localStorage).setItem('token', token || '');
  }
  function clearTokens() {
    STORAGE_KEYS.forEach(k => localStorage.removeItem(k));
    STORAGE_KEYS.forEach(k => sessionStorage.removeItem(k));
    try { localStorage.removeItem(USER_CACHE_KEY); } catch {}
  }

  // ---- JWT decode & expiry ----
  function decodeJWT(t) {
    try {
      const b64 = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(atob(b64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
      return JSON.parse(json);
    } catch {
      return {};
    }
  }
  function isExpired(t) {
    const p = decodeJWT(t);
    if (!p || !p.exp) return false;
    return Math.floor(Date.now() / 1000) >= p.exp;
  }

  // ---- Navigation helpers ----
  const redirectTo = (p) => { location.href = p; };
  const redirectToHome = () => redirectTo('./home.html');
  const redirectToLogin = () => {
    const next = encodeURIComponent(location.pathname + location.search);
    redirectTo(`./login.html?next=${next}`);
  };

  // ---- API base helpers ----
  function apiUrl(path) {
    const hasAPI = typeof window.API?.url === 'function';
    if (hasAPI) return window.API.url(path);
    // Fallback: same-origin
    return path.startsWith('/') ? path : '/' + path;
  }

  // ---- Core auth flows ----
  function signOut() {
    clearTokens();
    redirectToLogin();
  }

  function hardRedirectIfNotAuthed() {
    const t = getToken();
    if (!t || isExpired(t)) redirectToLogin();
  }

  async function requireAuth() {
    const t = getToken();
    if (!t || isExpired(t)) {
      signOut();
      throw new Error('Not authenticated');
    }
    const res = await fetch(apiUrl('/api/user/me'), {
      headers: { Authorization: `Bearer ${t}` },
      cache: 'no-store'
    });
    if (res.status === 401) { signOut(); throw new Error('Unauthorized'); }
    if (!res.ok) throw new Error('Auth check failed');

    const me = await res.json();
    window.__ME__ = me;
    try { localStorage.setItem(USER_CACHE_KEY, JSON.stringify(me)); } catch {}
    // Personalise banner if available
    const h = document.querySelector('h1.page-title, h1');
    if (h && !h.dataset.lockTitle) {
      const name = (me?.firstName || '').trim();
      if (name && !h.textContent.includes(name)) h.textContent = `${name} — ${h.textContent}`;
    }
    const g = document.getElementById('greeting-name');
    if (g && me?.firstName) g.textContent = me.firstName;

    return { token: t, me };
  }

  function authFetch(url, options = {}) {
    const t = getToken();
    if (!t) { signOut(); return Promise.reject(new Error('No token')); }
    const headers = Object.assign({}, options.headers || {}, { Authorization: `Bearer ${t}` });
    return fetch(apiUrl(url), Object.assign({}, options, { headers }))
      .then(r => { if (r.status === 401) signOut(); return r; });
  }

  // ---- Page guard & UX helpers ----
  function enforce(opts = {}) {
    const path = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    const allow = new Set((opts.allowAnonymous || ['login.html', 'signup.html', 'index.html']).map(s => s.toLowerCase()));
    const t = getToken();
    const authed = !!t && !isExpired(t);

    if (!allow.has(path)) {
      hardRedirectIfNotAuthed();
    } else if (opts.bounceIfAuthed && authed) {
      redirectToHome();
    }
  }

  function setBannerTitle(suffix) {
    const name = (window.__ME__?.firstName || '').trim();
    const title = name ? `${name} — ${suffix}` : suffix;
    document.title = title;
    const h = document.querySelector('h1.page-title, h1');
    if (h && !h.dataset.lockTitle) h.textContent = title;
    const g = document.getElementById('greeting-name');
    if (g && name) g.textContent = name;
  }

  // Expose API
  window.Auth = {
    // tokens
    getToken, setToken, isExpired, decodeJWT,
    // flows
    signOut, hardRedirectIfNotAuthed, requireAuth,
    // fetch wrapper (adds Authorization + API base)
    fetch: authFetch,
    // guards & UI sugar
    enforce, setBannerTitle
  };

    // ---- Global Sign Out click handler (works even if navbar is injected later) ----
    if (!window.__boundSignoutHandler) {
      document.addEventListener('click', async (ev) => {
        const btn = ev.target.closest('#nav-signout');
        if (!btn) return;
  
        ev.preventDefault();
  
        // If you maintain a server-side session, optionally notify the backend:
        // try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); } catch {}
  
        // Clear local tokens & redirect (already implemented in Auth.signOut)
        Auth.signOut();
      });
      window.__boundSignoutHandler = true;
    }
  
})();

