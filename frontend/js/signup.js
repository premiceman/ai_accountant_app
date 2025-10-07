// frontend/js/signup.js
// Simplified signup flow wired to WorkOS AuthKit-backed backend endpoints.

(function () {
  const $ = (sel, root = document) => root.querySelector(sel);

  const form = $('#signupForm');
  if (!form) return;

  const fields = {
    firstName: $('#firstName'),
    lastName: $('#lastName'),
    email: $('#email'),
    dateOfBirth: $('#dateOfBirth'),
    password: $('#password'),
    passwordConfirm: $('#passwordConfirm'),
    agreeLegal: $('#agreeLegal'),
  };

  const signupBtn = $('#signupBtn');
  const globalError = $('#signup-error');
  const params = new URLSearchParams(location.search);
  const next = params.get('next') || './home.html';

  const setFieldError = (name, message) => {
    const input = fields[name];
    const helper = document.querySelector(`[data-error-for="${name}"]`);
    if (helper) helper.textContent = message || '';
    if (input) {
      if (message) {
        input.classList.add('is-invalid');
        input.classList.remove('is-valid');
      } else {
        input.classList.remove('is-invalid');
      }
    }
  };

  const clearAllErrors = () => {
    Object.keys(fields).forEach((key) => setFieldError(key, ''));
    if (globalError) {
      globalError.textContent = '';
      globalError.classList.add('d-none');
    }
  };

  const showGlobalError = (message) => {
    if (!globalError) {
      alert(message);
      return;
    }
    globalError.textContent = message;
    globalError.classList.remove('d-none');
  };

  function isEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
  }

  async function startProvider(provider, button) {
    if (!provider || !button) return;
    clearAllErrors();
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Redirecting…';
    try {
      const url = new URL('/api/auth/workos/authorize', location.origin);
      url.searchParams.set('provider', provider);
      url.searchParams.set('next', next);
      url.searchParams.set('remember', 'true');
      const res = await fetch(url.toString());
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.authorizationUrl) {
        showGlobalError(data?.error || 'Unable to start single sign-on. Please try again.');
        return;
      }
      location.href = data.authorizationUrl;
    } catch (err) {
      console.error('Signup provider error:', err);
      showGlobalError('Network error. Please try again.');
    } finally {
      button.disabled = false;
      if (original) button.textContent = original;
    }
  }

  $('#signupGoogle')?.addEventListener('click', () => startProvider('google', $('#signupGoogle')));
  $('#signupMicrosoft')?.addEventListener('click', () => startProvider('microsoft', $('#signupMicrosoft')));
  $('#signupApple')?.addEventListener('click', () => startProvider('apple', $('#signupApple')));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearAllErrors();

    const firstName = (fields.firstName?.value || '').trim();
    const lastName = (fields.lastName?.value || '').trim();
    const email = (fields.email?.value || '').trim();
    const dateOfBirth = fields.dateOfBirth?.value || '';
    const password = fields.password?.value || '';
    const passwordConfirm = fields.passwordConfirm?.value || '';
    const agreeLegal = fields.agreeLegal?.checked === true;

    let invalid = false;
    if (!firstName) { setFieldError('firstName', 'First name is required'); invalid = true; }
    if (!lastName) { setFieldError('lastName', 'Last name is required'); invalid = true; }
    if (!email) { setFieldError('email', 'Email is required'); invalid = true; }
    else if (!isEmail(email)) { setFieldError('email', 'Enter a valid email'); invalid = true; }
    if (!dateOfBirth) { setFieldError('dateOfBirth', 'Date of birth is required'); invalid = true; }
    if (!password) { setFieldError('password', 'Password is required'); invalid = true; }
    else if (password.length < 8) { setFieldError('password', 'Use at least 8 characters'); invalid = true; }
    if (!passwordConfirm) { setFieldError('passwordConfirm', 'Please confirm your password'); invalid = true; }
    else if (password && passwordConfirm && password !== passwordConfirm) {
      setFieldError('passwordConfirm', 'Passwords do not match');
      invalid = true;
    }
    if (!agreeLegal) { setFieldError('agreeLegal', 'You must accept the terms to continue'); invalid = true; }

    if (invalid) return;

    const original = signupBtn?.textContent;
    if (signupBtn) {
      signupBtn.disabled = true;
      signupBtn.textContent = 'Creating account…';
    }

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName,
          lastName,
          email,
          dateOfBirth,
          password,
          passwordConfirm,
          agreeLegal: true,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const message = data?.error || 'Sign up failed. Please try again.';
        if (/email/i.test(message)) setFieldError('email', message);
        else if (/password/i.test(message)) setFieldError('password', message);
        else if (/birth|date/i.test(message)) setFieldError('dateOfBirth', message);
        else showGlobalError(message);
        return;
      }

      if (!data?.token) {
        showGlobalError('No token returned from server.');
        return;
      }

      try {
        localStorage.setItem('token', data.token);
        if (data.user) localStorage.setItem('me', JSON.stringify(data.user));
      } catch (storageErr) {
        console.warn('Failed to cache auth data:', storageErr);
      }

      location.href = next;
    } catch (err) {
      console.error('Signup error:', err);
      showGlobalError('Network error. Please try again.');
    } finally {
      if (signupBtn) {
        signupBtn.disabled = false;
        if (original) signupBtn.textContent = original;
      }
    }
  });
})();
