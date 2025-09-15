// /frontend/js/auth.js
(() => {
  const BASE = (window.__API_BASE || location.origin).replace(/\/+$/, '');

  async function check() {
    try {
      const res = await fetch(`${BASE}/api/auth/check`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store'
      });
      if (!res.ok) return false;
      const data = await res.json().catch(() => ({}));
      // expose minimal user object if the server returns one
      window.currentUser = data && data.user ? data.user : null;
      return true;
    } catch {
      return false;
    }
  }

  // enforces auth by redirecting to login.html if not authenticated
  async function enforce(required = true) {
    const ok = await check();
    if (required && !ok) {
      const next = encodeURIComponent(location.pathname + location.search);
      location.href = `/login.html?next=${next}`;
      return false;
    }
    return ok;
  }

  // wrapper for API calls that always includes cookies
  async function apiFetch(path, opts = {}) {
    const url = /^https?:\/\//i.test(path) ? path : `${BASE}${path}`;
    return fetch(url, { credentials: 'include', ...opts });
  }

  const Auth = { enforce, check, apiFetch, apiBase: BASE };

  // 🔁 Compatibility aliases so legacy code keeps working
  Auth.requireAuth  = Auth.enforce;  // many pages call this
  Auth.requireLogin = Auth.enforce;  // just in case
  Auth.fetch        = Auth.apiFetch; // some code may use Auth.fetch

  window.Auth = Auth;
})();
