// /frontend/js/auth.js
(() => {
  const BASE = (window.__API_BASE || location.origin).replace(/\/+$/, '');

  const stores = [localStorage, sessionStorage];

  function getToken() {
    for (const s of stores) {
      try {
        const t = s.getItem('token');
        if (t) return t;
      } catch {}
    }
    return null;
  }

  function clearAuth() {
    const KEYS = ['token', 'jwt', 'authToken', 'me'];
    for (const s of stores) {
      try { KEYS.forEach(k => s.removeItem(k)); } catch {}
    }
    try { window.currentUser = null; } catch {}
  }

  function withAuthHeaders(headers = {}) {
    const h = new Headers(headers || {});
    const t = getToken();
    if (t && !h.has('Authorization')) h.set('Authorization', `Bearer ${t}`);
    return h;
  }

  async function fetchWithAuth(path, opts = {}) {
    const url = path.startsWith('http') ? path : `${BASE}${path}`;
    const init = {
      credentials: 'include', // still send cookies if present
      cache: 'no-store',
      ...opts,
    };
    init.headers = withAuthHeaders(init.headers);
    return fetch(url, init);
  }

  // Lightweight page title helper used around the app
  function setBannerTitle(title) {
    try {
      const el =
        document.querySelector('[data-page-title]') ||
        document.querySelector('.page-title') ||
        document.querySelector('h1');
      if (el && title) el.textContent = title;
      if (title) document.title = `${title} — AI Accountant`;
    } catch {}
  }

  // Core: verify auth by calling a protected endpoint with Bearer token
  async function check() {
    const token = getToken();
    if (!token) return false;
    try {
      const res = await fetchWithAuth('/api/user/me', { method: 'GET' });
      if (!res.ok) return false;
      const data = await res.json().catch(() => ({}));
      // Accept either { user: {...} } or a bare user object
      window.currentUser = (data && (data.user || data)) || null;
      return true;
    } catch {
      return false;
    }
  }

  // Redirect to login if not authenticated
  async function requireAuth() {
    const ok = await check();
    if (!ok) {
      const next = encodeURIComponent(location.pathname + location.search);
      location.href = `/login.html?next=${next}`;
      throw new Error('Not authenticated');
    }
    return { token: getToken(), me: window.currentUser || null };
  }

  // Compatibility with pages that call Auth.enforce(true)
  async function enforce(redirect = true) {
    const ok = await check();
    if (!ok && redirect) {
      const next = encodeURIComponent(location.pathname + location.search);
      location.href = `/login.html?next=${next}`;
    }
    return ok;
  }

  async function signOut() {
    try { await fetchWithAuth('/api/auth/logout', { method: 'POST' }); } catch {}
    clearAuth();
    const next = encodeURIComponent(location.pathname + location.search);
    location.href = `/login.html?next=${next}`;
  }

  // Expose helpers
  window.Auth = {
    apiBase: BASE,
    fetch: fetchWithAuth,      // used across your app
    apiFetch: fetchWithAuth,   // back-compat
    requireAuth,
    enforce,
    check,
    signOut,
    setBannerTitle,
    getToken,
  };
})();
