// frontend/js/login.js
// Minimal redirect shim: immediately send users to the WorkOS hosted login.
(function(){
  const params = new URLSearchParams(window.location.search || '');
  const manual = params.get('manual') === '1';
  const errorMessage = params.get('error');
  const next = params.get('next') || undefined;
  const email = (params.get('email') || '').trim() || undefined;
  const rememberParam = (params.get('remember') || '').toLowerCase();
  const remember = rememberParam ? ['true','1','yes','on'].includes(rememberParam) : true;

  const statusEl = document.getElementById('redirect-status');
  const errorEl = document.getElementById('redirect-error');
  const linkEl = document.getElementById('redirect-link');

  function buildUrl() {
    if (window.Auth && typeof Auth.buildWorkOSUrl === 'function') {
      return Auth.buildWorkOSUrl({ intent: 'login', next, email, remember });
    }
    const url = new URL('/api/auth/workos/login', window.location.origin);
    url.searchParams.set('intent', 'login');
    if (next) url.searchParams.set('next', next);
    if (remember) url.searchParams.set('remember', 'true');
    if (email) url.searchParams.set('email', email);
    return url.toString();
  }

  function showError(message) {
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.classList.remove('d-none');
    } else {
      console.error('Login redirect error:', message);
    }
    if (statusEl) {
      statusEl.textContent = 'Select “Continue” below to open the secure login.';
    }
  }

  const destination = buildUrl();
  if (linkEl) linkEl.href = destination;

  if (errorMessage) {
    showError(errorMessage);
  } else if (statusEl) {
    statusEl.textContent = 'Redirecting you to the secure WorkOS login…';
  }

  if (!manual && !errorMessage) {
    window.setTimeout(() => {
      window.location.assign(destination);
    }, 150);
  }
})();
