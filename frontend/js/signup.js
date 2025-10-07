// frontend/js/signup.js
// Routes sign-up flows through the WorkOS hosted experience so the backend receives the callback.
(function(){
  const params = new URLSearchParams(window.location.search || '');
  const next = params.get('next') || './home.html';
  const error = params.get('error');
  const manual = params.get('manual');
  const emailHint = (params.get('email') || '').trim();

  const statusEl = document.getElementById('signup-status');
  const errorEl = document.getElementById('signup-error');

  const primaryBtn = document.getElementById('signupWorkOSBtn');
  const googleBtn = document.getElementById('signupGoogle');
  const microsoftBtn = document.getElementById('signupMicrosoft');
  const appleBtn = document.getElementById('signupApple');

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
      statusEl.textContent = 'Choose how you’d like to continue your sign-up.';
    }
  }

  function buildUrl(options = {}) {
    const url = new URL('/api/auth/workos/start', window.location.origin);
    url.searchParams.set('next', options.next || next);
    url.searchParams.set('intent', options.intent || 'signup');
    url.searchParams.set('remember', 'true');
    const loginHint = (options.email || emailHint || '').trim();
    if (loginHint) {
      url.searchParams.set('email', loginHint);
    }
    if (options.provider) {
      url.searchParams.set('provider', options.provider);
    }
    return url;
  }

  function startHostedSignup(options = {}) {
    if (redirected) return;
    redirected = true;
    if (statusEl) {
      statusEl.textContent = 'Redirecting you to secure sign-up…';
    }
    const url = buildUrl(options);
    window.location.assign(url.toString());
  }

  primaryBtn?.addEventListener('click', () => startHostedSignup({}));
  googleBtn?.addEventListener('click', () => startHostedSignup({ provider: 'google' }));
  microsoftBtn?.addEventListener('click', () => startHostedSignup({ provider: 'microsoft' }));
  appleBtn?.addEventListener('click', () => startHostedSignup({ provider: 'apple' }));

  if (error) {
    showError(error);
  } else if (statusEl) {
    statusEl.textContent = 'Redirecting you to the WorkOS hosted sign-up…';
  }

  const autoStart = manual !== '1' && !error;
  if (autoStart) {
    window.setTimeout(() => startHostedSignup({}), 900);
  } else if (statusEl && !error) {
    statusEl.textContent = 'Choose how you’d like to continue your sign-up.';
  }
})();
