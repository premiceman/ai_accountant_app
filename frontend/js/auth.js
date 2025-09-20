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
    if (session) sessionStorage.setItem('token', token);
    else localStorage.setItem('token', token);
  }

  function clearTokens() {
    for (const k of STORAGE_KEYS) {
      try { localStorage.removeItem(k); } catch {}
      try { sessionStorage.removeItem(k); } catch {}
    }
    try { localStorage.removeItem(USER_CACHE_KEY); } catch {}
    try { sessionStorage.removeItem(USER_CACHE_KEY); } catch {}
  }

  function decodeJWT(t) {
    try {
      const b64 = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(atob(b64).split('').map(c =>
        '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
      ).join(''));
      return JSON.parse(json);
    } catch { return null; }
  }

  function isExpired(token) {
    const p = decodeJWT(token);
    if (!p || !p.exp) return false;
    const now = Math.floor(Date.now() / 1000);
    return p.exp <= now + 5;
  }

  async function fetchWithAuth(url, options = {}) {
    const token = getToken();
    const headers = new Headers(options.headers || {});
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(url, { ...options, headers });
  }

  async function requireAuth() {
    const t = getToken();
    if (!t || isExpired(t)) {
      clearTokens();
      location.replace('/login.html?next=' + encodeURIComponent(location.pathname + location.search));
      throw new Error('Not authenticated');
    }
    try {
      const res = await fetchWithAuth('/api/user/me', { cache: 'no-store' });
      if (!res.ok) throw new Error('me failed');
      const me = await res.json();
      window.__ME__ = me;
      const g = document.getElementById('greeting-name');
      if (g && me?.firstName) g.textContent = me.firstName;
      return { me, token: t };
    } catch {
      return { me: null, token: t };
    }
  }

  function setBannerTitle(title) {
    const h = document.getElementById('banner-title');
    if (h && !h.dataset.lockTitle) h.textContent = title;
  }

  // ✅ Back-compat for pages that call Auth.enforce()
  async function enforce() { return requireAuth(); }

  window.Auth = {
    getToken, setToken, clearTokens,
    requireAuth, enforce,
    fetch: fetchWithAuth,
    setBannerTitle
  };
})();
