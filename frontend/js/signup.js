// frontend/js/signup.js
// Robust signup: client-side validation, confirm password, live availability checks.

(function () {
  function $(sel, root = document) { return root.querySelector(sel); }
  function setErr(name, msg) {
    const el = document.querySelector(`[data-error-for="${name}"]`);
    if (el) el.textContent = msg || '';
    const input = document.getElementById(name);
    if (input) input.classList.toggle('is-invalid', !!msg);
  }
  function clearErrors() {
    document.querySelectorAll('.form-text.error').forEach(el => el.textContent = '');
    document.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
  }
  function getVal(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }

  async function checkAvailability({ email, username }) {
    const params = new URLSearchParams();
    if (email) params.set('email', email);
    if (username) params.set('username', username);
    if ([...params].length === 0) return {};
    const url = (window.API ? API.url(`/api/auth/check?${params}`) : `/api/auth/check?${params}`);
    const res = await fetch(url);
    if (!res.ok) return {};
    return res.json();
  }

  // Live checks on blur
  let deb;
  function debounce(fn, ms=250) { return (...args) => { clearTimeout(deb); deb = setTimeout(() => fn(...args), ms); }; }

  async function onEmailBlur() {
    const email = getVal('email');
    setErr('email', '');
    if (!email) return;
    const { emailAvailable } = await checkAvailability({ email });
    if (emailAvailable === false) setErr('email', 'Email already registered');
  }
  async function onUsernameBlur() {
    const username = getVal('username');
    setErr('username', '');
    if (!username) return;
    const { usernameAvailable } = await checkAvailability({ username });
    if (usernameAvailable === false) setErr('username', 'Username already in use');
  }

  document.addEventListener('DOMContentLoaded', () => {
    const form = $('#signupForm');
    if (!form) return;

    $('#email')?.addEventListener('blur', debounce(onEmailBlur, 200));
    $('#username')?.addEventListener('blur', debounce(onUsernameBlur, 200));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearErrors();

      const firstName = getVal('firstName');
      const lastName  = getVal('lastName');
      const username  = getVal('username');
      const email     = getVal('email');
      const dateOfBirth = getVal('dateOfBirth');
      const password  = getVal('password');
      const passwordConfirm = getVal('passwordConfirm');

      // Client-side validations
      if (!firstName) setErr('firstName', 'First name is required');
      if (!lastName)  setErr('lastName', 'Last name is required');
      if (!email)     setErr('email', 'Email is required');
      if (!dateOfBirth) setErr('dateOfBirth', 'Date of birth is required');
      if (!password)  setErr('password', 'Password is required');
      if (!passwordConfirm) setErr('passwordConfirm', 'Please confirm your password');
      if (password && password.length < 8) setErr('password', 'Password must be at least 8 characters');
      if (password && passwordConfirm && password !== passwordConfirm) setErr('passwordConfirm', 'Passwords do not match');

      const anyErr = document.querySelector('.is-invalid');
      if (anyErr) return;

      // Try server-side availability (last check before POST)
      try {
        const avail = await checkAvailability({ email, username });
        if (avail.emailAvailable === false) setErr('email', 'Email already registered');
        if (avail.usernameAvailable === false) setErr('username', 'Username already in use');
      } catch {}
      if (document.querySelector('.is-invalid')) return;

      // Submit
      const btn = $('#signupBtn');
      btn?.setAttribute('disabled', 'true');

      try {
        const res = await fetch((window.API ? API.url('/api/auth/signup') : '/api/auth/signup'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ firstName, lastName, username, email, dateOfBirth, password, passwordConfirm }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg = data?.error || 'Sign up failed';
          // Map common errors to fields
          if (/email/i.test(msg)) setErr('email', msg);
          else if (/username/i.test(msg)) setErr('username', msg);
          else if (/password/i.test(msg)) setErr('password', msg);
          else if (/birth/i.test(msg)) setErr('dateOfBirth', msg);
          else setErr('email', msg);
          return;
        }

        // Success: store token & bounce to app
        if (data.token) {
          // session vs persistent — keep your current behavior (default localStorage)
          Auth.setToken(data.token);
        }
        // Redirect: respect ?next= if present
        const params = new URLSearchParams(location.search);
        const next = params.get('next');
        location.replace(next && next.startsWith('/') ? next : './home.html');
      } catch (err) {
        console.error('Signup POST error:', err);
        setErr('email', 'Network error — please try again');
      } finally {
        btn?.removeAttribute('disabled');
      }
    });
  });
})();
