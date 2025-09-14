// frontend/js/auth.js
const Auth = (() => {
  const TOKEN_KEY = 'auth_token';

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
  }

  function setToken(token) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {}
  }

  async function fetchWithAuth(input, init = {}) {
    const headers = new Headers(init.headers || {});
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const res = await fetch(input, { ...init, headers, credentials: 'include' });

    if (res.status === 401) {
      // nuke any stale token and bounce to login
      setToken('');
      if (!location.pathname.endsWith('/login.html')) {
        location.href = '/login.html';
      }
      throw new Error('Unauthorized');
    }
    return res;
  }

  async function requireAuth() {
    const token = getToken();
    if (!token) {
      location.href = '/login.html';
      return;
    }
    // Optionally ping /api/user/me to ensure the token is valid
    const res = await fetchWithAuth('/api/user/me');
    if (!res.ok) {
      location.href = '/login.html';
      return;
    }
  }

  function logout() {
    setToken('');
    // Optionally call your backend logout if you have one
    location.href = '/login.html';
  }

  return { getToken, setToken, fetch: fetchWithAuth, requireAuth, logout };
})();
