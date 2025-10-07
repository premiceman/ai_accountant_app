// frontend/js/login.js
// Redirect all sign-in flows through the WorkOS hosted authentication experience.
(function(){
  const params = new URLSearchParams(window.location.search || '');
  const next = params.get('next') || './home.html';
  const error = params.get('error');
  const manual = params.get('manual');
  const emailHint = (params.get('email') || '').trim();

  const statusEl = document.getElementById('login-status');
  const errorEl = document.getElementById('login-error');
  const rememberToggle = document.getElementById('rememberDevice');

  const generalBtn = document.getElementById('workosLoginBtn');
  const googleBtn = document.getElementById('googleBtn');
  const microsoftBtn = document.getElementById('microsoftBtn');
  const appleBtn = document.getElementById('appleBtn');

  let redirected = false;

  function showError(message) {
    if (!message) return;
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.classList.remove('d-none');
    } else {
      alert(message);
    }
    if (statusEl) {
      statusEl.textContent = 'Choose how you’d like to sign in to try again.';
    }
  }

  function buildUrl(options = {}) {
    const url = new URL('/api/auth/workos/login', window.location.origin);
    url.searchParams.set('next', options.next || next);
    url.searchParams.set('intent', options.intent || 'login');
    if (rememberToggle?.checked) {
      url.searchParams.set('remember', 'true');
    }
    const loginHint = (options.email || emailHint || '').trim();
    if (loginHint) {
      url.searchParams.set('email', loginHint);
    }
    if (options.provider) {
      url.searchParams.set('provider', options.provider);
    }
    return url;
  }

  function startHostedLogin(options = {}) {
    if (redirected) return;
    redirected = true;
    if (statusEl) {
      statusEl.textContent = 'Redirecting you to secure sign-in…';
    }
    const url = buildUrl(options);
    window.location.assign(url.toString());
  }

  generalBtn?.addEventListener('click', () => startHostedLogin({}));
  googleBtn?.addEventListener('click', () => startHostedLogin({ provider: 'google' }));
  microsoftBtn?.addEventListener('click', () => startHostedLogin({ provider: 'microsoft' }));
  appleBtn?.addEventListener('click', () => startHostedLogin({ provider: 'apple' }));

  if (error) {
    showError(error);
  } else if (statusEl) {
    statusEl.textContent = 'Redirecting you to the WorkOS hosted login…';
  }

  const autoStart = manual !== '1' && !error;
  if (autoStart) {
    window.setTimeout(() => startHostedLogin({}), 900);
  } else if (statusEl && !error) {
    statusEl.textContent = 'Choose how you’d like to sign in.';
  }
})();
