// /frontend/js/auth.js
(() => {
  const BASE = (window.__API_BASE || location.origin).replace(/\/+$/, '');
  const LOGIN_URL = '/login.html';

  // --- tiny helpers ---
  function q(sel, root=document) { return root.querySelector(sel); }
  function qa(sel, root=document) { return Array.from(root.querySelectorAll(sel)); }

  function setText(el, text) {
    if (!el) return;
    if ('textContent' in el) el.textContent = text ?? '';
  }

  function includeCreds(path, opts = {}) {
    const url = /^https?:\/\//i.test(path) ? path : `${BASE}${path}`;
    return fetch(url, { credentials: 'include', ...opts });
  }

  // --- core session helpers ---
  async function check() {
    try {
      const res = await includeCreds('/api/auth/check', { method: 'GET', cache: 'no-store' });
      if (!res.ok) return false;
      const data = await res.json().catch(() => ({}));
      setUser(data?.user || null);
      return true;
    } catch {
      return false;
    }
  }

  async function enforce(required = true) {
    const ok = await check();
    if (required && !ok) {
      const next = encodeURIComponent(location.pathname + location.search);
      location.href = `${LOGIN_URL}?next=${next}`;
      return false;
    }
    return ok;
  }

  // --- user state + UI wiring ---
  let _user = null;
  const _listeners = new Set();

  function setUser(u) {
    _user = u || null;
    window.currentUser = _user; // legacy compatibility
    // Toggle UI: anything with data-auth="authed" or data-auth="guest"
    qa('[data-auth]').forEach(el => {
      const mode = el.getAttribute('data-auth');
      const show = (mode === 'authed') ? !!_user : !(_user);
      el.style.display = show ? '' : 'none';
    });
    // Simple common bindings
    qa('[data-username]').forEach(el => setText(el, _user?.name || _user?.email || ''));
    qa('[data-user-email]').forEach(el => setText(el, _user?.email || ''));
    qa('[data-user-initials]').forEach(el => {
      const n = (_user?.name || '').trim();
      const initials = n ? n.split(/\s+/).map(s => s[0]).join('').slice(0,2).toUpperCase() :
                     (_user?.email ? _user.email[0].toUpperCase() : '');
      setText(el, initials);
    });
    _listeners.forEach(fn => { try { fn(_user); } catch(_){} });
  }

  function getUser() { return _user; }

  async function signOut(redirectTo = LOGIN_URL) {
    try { await includeCreds('/api/auth/logout', { method: 'POST' }); } catch {}
    setUser(null);
    if (redirectTo) location.href = redirectTo;
  }

  function onAuthChange(fn) { if (typeof fn === 'function') _listeners.add(fn); return () => _listeners.delete(fn); }

  // --- UI niceties expected by older pages ---
  function setBannerTitle(text, { selector } = {}) {
    // Try explicit selector, then common ids/attrs, fallback to document.title
    const el = selector ? q(selector)
      : q('#bannerTitle') || q('[data-banner-title]') || q('.page-title h1') || q('h1');
    setText(el, text || '');
    if (text) document.title = String(text).replace(/\s+/g, ' ').trim() + ' — AI Accountant';
  }

  function setBannerSubtitle(text, { selector } = {}) {
    const el = selector ? q(selector)
      : q('#bannerSubtitle') || q('[data-banner-subtitle]') || q('.page-title .subtitle') || q('h2');
    setText(el, text || '');
  }

  // --- API helpers ---
  async function apiFetch(path, opts = {}) {
    return includeCreds(path, opts);
  }

  async function getJSON(path) {
    const res = await apiFetch(path);
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
    return res.json();
  }

  async function postJSON(path, body) {
    const res = await apiFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
    return res.json();
  }

  // Build the Auth object
  const core = {
    // base + user
    apiBase: BASE,
    getUser, setUser, onAuthChange, signOut,

    // session
    check, enforce,

    // legacy names (aliases)
    requireAuth: enforce,
    requireLogin: enforce,

    // fetchers
    apiFetch, fetch: apiFetch, getJSON, postJSON,

    // UI helpers used by legacy pages
    setBannerTitle,
    setBannerSubtitle
  };

  // Safety net: unknown Auth.method -> no-op function (prevents crashes)
  const Auth = new Proxy(core, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      // Avoid promise detection
      if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined;
      // Unknown method: return a no-op function with a console debug (once per method)
      let warned = false;
      return function noOpAuthFunc() {
        if (!warned) {
          console.debug(`[Auth] No-op for unknown method: ${String(prop)}()`);
          warned = true;
        }
        return undefined;
      };
    }
  });

  window.Auth = Auth;
})();
