// frontend/js/auth.js
(function () {
  // Keep compatibility with legacy token keys already in your app.
  const STORAGE_KEYS = ['token', 'jwt', 'authToken'];
  const USER_CACHE_KEY = 'me';
  const LANDING_PATH = '/';
  const APP_HOME = '/app';
  const ONBOARDING_PAGE = 'onboarding.html';
  const ONBOARDING_ROUTE = '/app/onboarding';
  const CSRF_COOKIE_NAME = 'phloat_csrf';
  const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE']);

  function currentPage() {
    const path = (location.pathname || '/').split('/').pop();
    return path && path.includes('.') ? path : 'index.html';
  }

  function needsMandatoryOnboarding(user) {
    if (!user) return true;
    if (user.onboardingComplete) return false;
    const hasUsername = typeof user.username === 'string' && user.username.trim().length >= 3;
    const hasDob = !!user.dateOfBirth;
    const interests = Array.isArray(user.profileInterests) ? user.profileInterests : [];
    const survey = user.onboardingSurvey || {};
    const hasSurveySignals = Array.isArray(survey.valueSignals) && survey.valueSignals.length >= 3 &&
      Array.isArray(survey.tierSignals) && survey.tierSignals.length >= 3;
    const hasPlanChoice = survey.planChoice && survey.planChoice.selection;
    return !(hasUsername && hasDob && interests.length && hasSurveySignals && hasPlanChoice);
  }

  function redirectToOnboarding() {
    if (currentPage() === ONBOARDING_PAGE || location.pathname === ONBOARDING_ROUTE) return;
    location.replace(ONBOARDING_ROUTE);
  }

  function getCookieValue(name) {
    if (typeof document === 'undefined') return null;
    const cookies = document.cookie ? document.cookie.split(';') : [];
    for (const cookie of cookies) {
      const [key, ...rest] = cookie.split('=');
      if (!key) continue;
      if (key.trim() === name) {
        try {
          return decodeURIComponent(rest.join('=').trim());
        } catch {
          return rest.join('=').trim();
        }
      }
    }
    return null;
  }

  function getCsrfToken() {
    return getCookieValue(CSRF_COOKIE_NAME);
  }

  function redirectToLanding() {
    if (location.pathname === LANDING_PATH) return;
    location.replace(LANDING_PATH);
  }

  function redirectToAppHome() {
    if (location.pathname === APP_HOME) return;
    location.replace(APP_HOME);
  }

  // ---------- Token helpers ----------
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
    for (const k of STORAGE_KEYS) {
      try { localStorage.removeItem(k); } catch {}
      try { sessionStorage.removeItem(k); } catch {}
    }
    try { localStorage.removeItem(USER_CACHE_KEY); } catch {}
    try { sessionStorage.removeItem(USER_CACHE_KEY); } catch {}
    window.__ME__ = null;
  }

  // ---------- JWT decode & basic expiry check ----------
  function decodeJWT(t) {
    try {
      const b64 = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(atob(b64).split('').map(c => {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      return JSON.parse(json);
    } catch {
      return null;
    }
  }
  function isExpired(token) {
    const payload = decodeJWT(token);
    if (!payload || !payload.exp) return false; // if no exp, don't assume expired
    const nowSec = Math.floor(Date.now() / 1000);
    // Add a tiny skew to avoid edge flicker
    return payload.exp <= (nowSec + 5);
  }

  // ---------- Fetch wrapper that adds Authorization when possible ----------
  async function fetchWithAuth(url, options = {}) {
    const token = getToken();
    const headers = new Headers(options.headers || {});
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const method = (options.method || 'GET').toUpperCase();
    if (!SAFE_METHODS.has(method)) {
      const csrfToken = getCsrfToken();
      if (csrfToken && !headers.has('X-CSRF-Token')) {
        headers.set('X-CSRF-Token', csrfToken);
      }
    }
    const response = await fetch(window.API ? window.API.url(url) : url, {
      ...options,
      credentials: options.credentials || 'include',
      headers,
    });
    if (response.status === 401 || response.status === 403) {
      clearTokens();
    }
    return response;
  }

  // ---------- Tolerant user load (keeps your current behaviour) ----------
  // Used by dashboard etc. We don't hard-fail UI here.
  async function loadUser(force = false) {
    if (!force && window.__ME__) return window.__ME__;
    const cached = (() => {
      try { return JSON.parse(localStorage.getItem(USER_CACHE_KEY) || sessionStorage.getItem(USER_CACHE_KEY) || 'null'); } catch {
        return null;
      }
    })();
    if (!force && cached) {
      window.__ME__ = cached;
      return cached;
    }

    const t = getToken();
    if (!t) return null;
    try {
      const res = await fetchWithAuth('/api/v2/me', { cache: 'no-store' });
      if (res.status === 401 || res.status === 403) {
        clearTokens();
        return null;
      }
      if (!res.ok) return null;
      const payload = await res.json();
      const me = payload?.me || payload || null;
      if (!me) return null;
      window.__ME__ = me;
      try { localStorage.setItem(USER_CACHE_KEY, JSON.stringify(me)); } catch {}
      return me;
    } catch {
      return null;
    }
  }

  function buildWorkOSUrl({ intent = 'login', next, email, remember = true } = {}) {
    const normalizedIntent = intent === 'signup' ? 'signup' : 'login';
    const basePath = normalizedIntent === 'signup' ? '/api/auth/workos/start' : '/api/auth/workos/login';
    const url = new URL(basePath, window.location.origin);
    const target = typeof next === 'string' && next.trim().startsWith('/') ? next.trim() : APP_HOME;
    url.searchParams.set('next', target);
    url.searchParams.set('intent', normalizedIntent);
    if (remember) url.searchParams.set('remember', 'true');
    if (email) url.searchParams.set('email', email);
    return url.toString();
  }

  async function requireAuth() {
    const token = getToken();
    if (!token || isExpired(token)) {
      clearTokens();
      redirectToLanding();
      return new Promise(() => {});
    }

    try {
      const res = await fetchWithAuth('/api/v2/me', { cache: 'no-store' });
      if (res.status === 401 || res.status === 403) {
        clearTokens();
        redirectToLanding();
        return new Promise(() => {});
      }
      if (!res.ok) {
        redirectToLanding();
        return new Promise(() => {});
      }

      const payload = await res.json();
      const me = payload?.me || payload || null;
      if (!me) {
        clearTokens();
        redirectToLanding();
        return new Promise(() => {});
      }

      window.__ME__ = me;
      try { localStorage.setItem(USER_CACHE_KEY, JSON.stringify(me)); } catch {}

      if (needsMandatoryOnboarding(me) && location.pathname !== ONBOARDING_ROUTE) {
        redirectToOnboarding();
        return new Promise(() => {});
      }

      const g = document.getElementById('greeting-name');
      if (g && me?.firstName) g.textContent = me.firstName;
      return { me, token };
    } catch {
      clearTokens();
      redirectToLanding();
      return new Promise(() => {});
    }
  }

  // ---------- Strict gate for protected pages ----------
  // Pages already call:
  //   Auth.enforce();                                 // protected pages
  //   Auth.enforce({ allowAnonymous:[...], bounceIfAuthed:true }); // login/signup
  async function enforce(opts = {}) {
    const defaults = {
      allowAnonymous: [
        'index.html',
        'login.html',
        'signup.html',
        '404.html',
        'unauthorized.html',
        'legal.html',
        'whats-new.html',
        LANDING_PATH,
        '/login',
        '/signup',
        '/legal',
        '/whats-new',
        '/unauthorized',
      ],
      bounceIfAuthed: false,
      validateWithServer: true,
    };
    const cfg = { ...defaults, ...opts };

    const pathname = location.pathname || '/';
    const page = currentPage();
    const allowSet = new Set(cfg.allowAnonymous);
    const token = getToken();
    const hasToken = !!token;
    const looksValid = hasToken && !isExpired(token);
    const isAnonymous = allowSet.has(pathname) || allowSet.has(page);

    if (isAnonymous) {
      if (!cfg.bounceIfAuthed) return;
      if (!looksValid) return;
      if (!cfg.validateWithServer) {
        redirectToAppHome();
        return;
      }
      try {
        const res = await fetchWithAuth('/api/v2/me', { cache: 'no-store' });
        if (res.ok) {
          const payload = await res.json();
          const me = payload?.me || payload || null;
          if (me) {
            window.__ME__ = me;
            try { localStorage.setItem(USER_CACHE_KEY, JSON.stringify(me)); } catch {}
            if (needsMandatoryOnboarding(me) && pathname !== ONBOARDING_ROUTE) {
              redirectToOnboarding();
              return;
            }
          }
          redirectToAppHome();
        }
      } catch { /* allow anonymous page if verification fails */ }
      return;
    }

    if (!hasToken || isExpired(token)) {
      clearTokens();
      redirectToLanding();
      return;
    }

    if (cfg.validateWithServer) {
      try {
        const res = await fetchWithAuth('/api/v2/me', { cache: 'no-store' });
        if (!res.ok) {
          clearTokens();
          redirectToLanding();
          return;
        }
        const payload = await res.json();
        const me = payload?.me || payload || null;
        if (me) {
          window.__ME__ = me;
          try { localStorage.setItem(USER_CACHE_KEY, JSON.stringify(me)); } catch {}
          if (needsMandatoryOnboarding(me) && pathname !== ONBOARDING_ROUTE) {
            redirectToOnboarding();
            return;
          }
        }
      } catch {
        clearTokens();
        redirectToLanding();
      }
    }
  }

  // ---------- Optional nicety used by your pages ----------
  function setBannerTitle(suffix) {
    const name = (window.__ME__?.firstName || '').trim();
    const title = name ? `${name} — ${suffix}` : suffix;
    document.title = title;
    const h = document.querySelector('h1.page-title, h1');
    if (h && !h.dataset.lockTitle) h.textContent = title;
    const g = document.getElementById('greeting-name');
    if (g && name) g.textContent = name;
  }

  function signOut({ next, redirect, reason = 'user-initiated' } = {}) {
    try {
      performance.mark?.('phloat:auth:signout:start');
    } catch { /* no-op */ }

    const defaultLanding = LANDING_PATH;
    const redirectTarget = typeof redirect === 'string' && redirect.trim().length
      ? redirect.trim()
      : null;
    const nextTarget = typeof next === 'string' && next.trim().length ? next.trim() : null;
    const context = {
      reason,
      from: location.pathname,
      redirect: redirectTarget || defaultLanding,
      next: nextTarget,
      timestamp: new Date().toISOString(),
    };

    try {
      console.info?.('[instrumentation] auth:signout:init', context);
    } catch { /* no-op */ }

    try {
      fetchWithAuth('/api/auth/logout', { method: 'POST' }).catch(() => {});
    } catch { /* ignore */ }

    clearTokens();

    let destination = redirectTarget || defaultLanding;
    if (!destination) {
      destination = buildWorkOSUrl({ intent: 'login', next: nextTarget || APP_HOME });
    }

    try {
      console.info?.('[instrumentation] auth:signout:redirect', { ...context, destination });
      performance.mark?.('phloat:auth:signout:redirect');
      performance.measure?.('phloat:auth:signout:duration', 'phloat:auth:signout:start', 'phloat:auth:signout:redirect');
    } catch { /* no-op */ }

    window.location.assign(destination);
  }

  async function getCurrentUser({ force = false } = {}) {
    const me = await loadUser(force);
    return me;
  }

  // Public API (names preserved)
  window.Auth = {
    getToken, setToken, clearTokens,
    requireAuth,
    fetch: fetchWithAuth,
    enforce,
    needsOnboarding: needsMandatoryOnboarding,
    setBannerTitle,
    signOut,
    buildWorkOSUrl,
    getCurrentUser,
    get me() { return window.__ME__; }
  };
})();
