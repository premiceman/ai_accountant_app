// frontend/js/auth.js
(function () {
  const STORAGE_KEYS = ['token', 'jwt', 'authToken'];
  const USER_CACHE_KEY = '__me';

  function getToken() {
    for (const k of STORAGE_KEYS) {
      const v = localStorage.getItem(k) || sessionStorage.getItem(k);
      if (v) return v;
    }
    return '';
  }

  function setToken(token, { session = false } = {}) {
    clearTokens();
    const store = session ? sessionStorage : localStorage;
    if (token) store.setItem('token', token);
  }

  function clearTokens() {
    try {
      for (const k of STORAGE_KEYS) {
        localStorage.removeItem(k);
        sessionStorage.removeItem(k);
      }
    } catch {}
    try { delete window[USER_CACHE_KEY]; } catch {}
  }

  function redirectToLogin() {
    if (!location.pathname.endsWith('/login.html')) location.href = '/login.html';
  }

  async function fetchWithAuth(url, options = {}) {
    const t = getToken();
    const headers = new Headers(options.headers || {});
    if (t) headers.set('Authorization', `Bearer ${t}`);
    const res = await fetch(window.API?.url ? window.API.url(url) : url, {
      ...options,
      headers,
      credentials: 'include', // send cookies if server uses httpOnly session
      cache: 'no-store'
    });
    if (res.status === 401) {
      clearTokens();
      redirectToLogin();
      throw new Error('Unauthorized');
    }
    return res;
  }

  // IMPORTANT: Try cookie-session flow even if no token is stored.
  async function requireAuth() {
    let t = getToken();

    // Always attempt to validate via /api/user/me (with or without token)
    const headers = new Headers();
    if (t) headers.set('Authorization', `Bearer ${t}`);

    const res = await fetch(window.API?.url ? window.API.url('/api/user/me') : '/api/user/me', {
      method: 'GET',
      headers,
      credentials: 'include',
      cache: 'no-store'
    });

    if (res.status === 401) {
      clearTokens();
      return redirectToLogin();
    }
    if (!res.ok) {
      clearTokens();
      return redirectToLogin();
    }

    const me = await res.json().catch(() => null);
    if (!me || !me.id) {
      clearTokens();
      return redirectToLogin();
    }

    try { window[USER_CACHE_KEY] = me; } catch {}

    // Optional page title/greeting update
    const h = document.querySelector('h1.page-title, h1');
    if (h && !h.dataset.lockTitle) {
      const base = h.dataset.baseTitle || h.textContent || document.title || 'Dashboard';
      h.dataset.baseTitle = base;
      if (me.firstName) h.textContent = `${me.firstName} — ${base}`;
    }
    const g = document.getElementById('greeting-name');
    if (g && me.firstName) g.textContent = me.firstName;

    return { token: t, me };
  }

  function logout() {
    clearTokens();
    location.href = '/login.html';
  }

  window.Auth = {
    getToken, setToken, clearTokens,
    fetch: fetchWithAuth, requireAuth, logout,
    setBannerTitle(suffix) {
      if (!suffix) return;
      const me = window[USER_CACHE_KEY];
      const name = (me?.firstName || '').trim();
      const title = name ? `${name} — ${suffix}` : suffix;
      document.title = title;
      const h = document.querySelector('h1.page-title, h1');
      if (h && !h.dataset.lockTitle) h.textContent = title;
      const g = document.getElementById('greeting-name');
      if (g && name) g.textContent = name;
    }
  };
})();
