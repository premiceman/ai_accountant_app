// frontend/js/workos-redirect.js
(function(){
  const scriptEl = document.currentScript;
  if (!scriptEl) return;

  function resolveBase(candidate) {
    if (!candidate) return null;
    try {
      return new URL(candidate, window.location.origin).toString();
    } catch {
      return null;
    }
  }

  const intent = (scriptEl.dataset.workosIntent || 'login').toLowerCase();
  const defaultNext = scriptEl.dataset.defaultNext || '/home.html';
  const redirectDelay = Number.parseInt(scriptEl.dataset.redirectDelay || '150', 10);
  const params = new URLSearchParams(window.location.search);

  const nextParam = params.get('next');
  const next = nextParam && nextParam.trim() ? nextParam : defaultNext;

  const base = resolveBase(scriptEl.dataset.apiBase)
    || resolveBase(window.__API_BASE)
    || resolveBase(window.API && window.API.baseUrl)
    || window.location.origin;

  const startUrl = new URL('/api/auth/workos/start', base);
  startUrl.searchParams.set('intent', intent);
  if (next) startUrl.searchParams.set('next', next);

  const rememberParam = params.get('remember');
  if (rememberParam && ['true','1','yes','on'].includes(rememberParam.toLowerCase())) {
    startUrl.searchParams.set('remember', 'true');
  }

  const emailParam = params.get('email') || params.get('login_hint');
  if (emailParam) {
    startUrl.searchParams.set('email', emailParam.trim());
  }

  const providerParam = params.get('provider');
  if (providerParam) {
    startUrl.searchParams.set('provider', providerParam);
  }

  const connectionParam = params.get('connection') || params.get('connectionId');
  if (connectionParam) {
    startUrl.searchParams.set('connection', connectionParam);
  }

  const fallbackLink = document.querySelector('[data-workos-continue]');
  if (fallbackLink) {
    fallbackLink.href = startUrl.toString();
    fallbackLink.classList.remove('d-none');
  }

  const statusEl = document.querySelector('[data-workos-status]');
  const detailEl = document.querySelector('[data-workos-detail]');
  const hintEl = document.querySelector('[data-workos-hint]');

  const errorParam = params.get('error');
  if (errorParam) {
    const message = decodeURIComponent(errorParam.replace(/\+/g, ' '));
    if (statusEl) statusEl.textContent = 'Authentication cancelled';
    if (detailEl) detailEl.textContent = message || 'We could not start the hosted authentication flow.';
    if (hintEl) hintEl.textContent = 'Use the button above to try again with WorkOS.';
    return;
  }

  if (statusEl) statusEl.textContent = intent === 'signup' ? 'Redirecting to secure sign-up…' : 'Redirecting to secure sign-in…';
  if (detailEl) detailEl.textContent = 'Please wait while we hand you off to our WorkOS-hosted authentication.';
  if (hintEl) hintEl.textContent = 'If nothing happens shortly, continue with the button above.';

  const delay = Number.isFinite(redirectDelay) && redirectDelay >= 0 ? redirectDelay : 150;
  window.setTimeout(() => {
    window.location.replace(startUrl.toString());
  }, delay);
})();
