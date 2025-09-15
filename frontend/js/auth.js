// /frontend/js/auth.js  (REPLACE FILE)
(() => {
  const BASE = (window.__API_BASE || location.origin).replace(/\/+$/, '');

  async function check() {
    try {
      const res = await fetch(`${BASE}/api/auth/check`, {
        method: 'GET',
        credentials: 'include',   // send session cookie
        cache: 'no-store'
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        window.currentUser = data.user || null;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  async function enforce(required = true) {
    const ok = await check();
    if (required && !ok) {
      const next = encodeURIComponent(location.pathname + location.search);
      location.href = `/login.html?next=${next}`;
    }
    return ok;
  }

  // Helper for all API calls so cookies are always included
  async function apiFetch(path, opts = {}) {
    const url = path.startsWith('http') ? path : `${BASE}${path}`;
    const defaults = { credentials: 'include' };
    return fetch(url, { ...defaults, ...opts });
  }

  window.Auth = { enforce, check, apiFetch, apiBase: BASE };
})();
