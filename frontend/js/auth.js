// frontend/js/auth.js
(function () {
  const STORAGE_KEYS = ['token', 'jwt', 'authToken'];
  const USER_CACHE_KEY = 'me';

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
    try {
      STORAGE_KEYS.forEach(k => { localStorage.removeItem(k); sessionStorage.removeItem(k); });
      localStorage.removeItem(USER_CACHE_KEY);
      sessionStorage.removeItem(USER_CACHE_KEY);
    } catch {}
  }

  async function fetchWithAuth(url, options = {}) {
    const t = getToken();
    const headers = Object.assign({}, options.headers || {}, t ? { Authorization: `Bearer ${t}` } : {});
    return fetch(window.API?.url ? window.API.url(url) : url, Object.assign({}, options, { headers }));
  }

  async function requireAuth() {
    try {
      const res = await fetchWithAuth('/api/user/me');
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        window.__ME__ = data.user || null;
        if (window.__ME__) {
          localStorage.setItem(USER_CACHE_KEY, JSON.stringify(window.__ME__));
        }
        return true;
      }
    } catch {}
    const next = encodeURIComponent(location.pathname + location.search);
    location.replace(`/login.html?next=${next}`);
    return false;
  }

  function isExpiredJWT(token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (!payload || !payload.exp) return true;
      return Date.now() >= payload.exp * 1000;
    } catch { return true; }
  }

  function enforce(opts = {}) {
    const path = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    const allow = new Set((opts.allowAnonymous || ['login.html','signup.html','index.html']).map(s => s.toLowerCase()));
    const t = getToken();
    const authed = !!t && !isExpiredJWT(t);
    if (!allow.has(path) && !authed) {
      const next = encodeURIComponent(location.pathname + location.search);
      location.replace(`/login.html?next=${next}`);
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

  function signOut() {
    clearTokens();
    const next = encodeURIComponent(location.pathname + location.search);
    location.replace(`/login.html?next=${next}`);
  }

  window.Auth = {
    getToken, setToken, clearTokens,
    requireAuth, fetch: fetchWithAuth, enforce, setBannerTitle, signOut
  };
})();
