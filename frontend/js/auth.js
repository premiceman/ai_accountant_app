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
      STORAGE_KEYS.forEach(k => localStorage.removeItem(k));
      STORAGE_KEYS.forEach(k => sessionStorage.removeItem(k));
      try { localStorage.removeItem(USER_CACHE_KEY); } catch {}
    }
  
    const redirectTo = (p) => { location.href = p; };
    const redirectToHome = () => redirectTo('./home.html');
  
    async function requireAuth() {
      // tolerant: fetch user but don't hard-fail UI
      const t = getToken();
      try {
        const res = await fetch(window.API.url('/api/user/me'), {
          headers: t ? { Authorization: `Bearer ${t}` } : {},
          cache: 'no-store'
        });
        const me = res.ok ? await res.json() : { firstName: 'Guest' };
        window.__ME__ = me;
        const h = document.querySelector('h1.page-title, h1');
        if (h && !h.dataset.lockTitle) {
          const name = (me?.firstName || '').trim();
          if (name && !h.textContent.includes(name)) h.textContent = `${name} — ${h.textContent}`;
        }
        const g = document.getElementById('greeting-name');
        if (g && me?.firstName) g.textContent = me.firstName;
        return { token: t, me };
      } catch {
        return { token: t, me: { firstName: 'Guest' } };
      }
    }
  
    function fetchWithAuth(url, options = {}) {
      const t = getToken();
      const headers = Object.assign({}, options.headers || {}, t ? { Authorization: `Bearer ${t}` } : {});
      return fetch(window.API.url(url), Object.assign({}, options, { headers }));
    }
  
    function enforce() { /* optional: add redirects if you need */ }
    function setBannerTitle(suffix) {
      const name = (window.__ME__?.firstName || '').trim();
      const title = name ? `${name} — ${suffix}` : suffix;
      document.title = title;
      const h = document.querySelector('h1.page-title, h1');
      if (h && !h.dataset.lockTitle) h.textContent = title;
      const g = document.getElementById('greeting-name');
      if (g && name) g.textContent = name;
    }
  
    window.Auth = {
      getToken, setToken, clearTokens,
      requireAuth, fetch: fetchWithAuth, enforce, setBannerTitle
    };
  })();
  