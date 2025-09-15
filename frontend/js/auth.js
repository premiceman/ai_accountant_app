// frontend/js/auth.js
(() => {
  const BASE = (window.__API_BASE || location.origin).replace(/\/+$/, '');

  async function check() {
    try {
      const res = await fetch(`${BASE}/api/auth/check`, {
        method: 'GET',
        credentials: 'include',
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

  async function apiFetch(path, opts = {}) {
    const url = path.startsWith('http') ? path : `${BASE}${path}`;
    return fetch(url, { credentials: 'include', ...opts });
  }

  window.Auth = { enforce, check, apiFetch, apiBase: BASE };
})();
