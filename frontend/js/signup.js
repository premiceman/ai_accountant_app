// frontend/js/signup.js
// Minimal redirect shim: send users straight to the WorkOS hosted sign-up.
(function(){
  const params = new URLSearchParams(window.location.search || '');
  const manual = params.get('manual') === '1';
  const errorMessage = params.get('error');
  const next = params.get('next') || undefined;
  const email = (params.get('email') || '').trim() || undefined;

  const statusEl = document.getElementById('redirect-status');
  const errorEl = document.getElementById('redirect-error');
  const linkEl = document.getElementById('redirect-link');

  function buildUrl() {
    if (window.Auth && typeof Auth.buildWorkOSUrl === 'function') {
      return Auth.buildWorkOSUrl({ intent: 'signup', next, email, remember: true });
    }
    const url = new URL('/api/auth/workos/start', window.location.origin);
    url.searchParams.set('intent', 'signup');
    url.searchParams.set('remember', 'true');
    if (next) url.searchParams.set('next', next);
    if (email) url.searchParams.set('email', email);
    return url.toString();
  }

  function showError(message) {
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.classList.remove('d-none');
    } else {
      console.error('Signup redirect error:', message);
    }
    if (statusEl) {
      statusEl.textContent = 'Select “Continue” below to create your account.';
    }
  }

  const destination = buildUrl();
  if (linkEl) linkEl.href = destination;

  if (errorMessage) {
    showError(errorMessage);
  } else if (statusEl) {
    statusEl.textContent = 'Redirecting you to the secure WorkOS sign-up…';
  }

  if (!manual && !errorMessage) {
    window.setTimeout(() => {
      window.location.assign(destination);
    }, 150);
  }
})();
