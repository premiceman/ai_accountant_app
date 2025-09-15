// frontend/js/signup.js
// Robust signup with on-theme validity cues, availability checks, and REQUIRED legal acceptance.

(function () {
  const LEGAL_VERSION = '2025-09-15'; // keep in sync with legal.html "Last updated"

  const $ = (sel, root = document) => root.querySelector(sel);
  const val = (id) => (document.getElementById(id)?.value ?? '').trim();

  function setErr(name, msg) {
    const help = document.querySelector(`[data-error-for="${name}"]`);
    if (help) help.textContent = msg || '';
    const input = document.getElementById(name);
    if (!input) return;
    input.classList.toggle('is-invalid', !!msg);
    if (msg) input.classList.remove('is-valid');
  }
  function setOk(name) {
    const input = document.getElementById(name);
    if (input) {
      input.classList.remove('is-invalid');
      input.classList.add('is-valid');
    }
  }
  function clearField(name) {
    const input = document.getElementById(name);
    const help  = document.querySelector(`[data-error-for="${name}"]`);
    if (help) help.textContent = '';
    if (input) { input.classList.remove('is-invalid','is-valid'); }
  }
  function clearAll() {
    ['firstName','lastName','username','email','dateOfBirth','password','passwordConfirm','agreeLegal'].forEach(clearField);
  }
  function isEmail(x) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(x || '')); }

  async function checkAvailability({ email, username }) {
    const params = new URLSearchParams();
    if (email)    params.set('email', email);
    if (username) params.set('username', username);
    if ([...params].length === 0) return {};
    const url = (window.API ? API.url(`/api/auth/check?${params}`) : `/api/auth/check?${params}`);
    const res = await fetch(url);
    if (!res.ok) return {};
    return res.json();
  }
  const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  async function onEmailBlur() {
    const email = val('email');
    if (!email) { clearField('email'); return; }
    if (!isEmail(email)) { setErr('email','Invalid email'); return; }
    try {
      const { emailAvailable } = await checkAvailability({ email });
      if (emailAvailable === false) setErr('email','Email already registered');
      else setOk('email');
    } catch {}
  }
  async function onUsernameBlur() {
    const username = val('username');
    if (!username) { clearField('username'); return; }
    try {
      const { usernameAvailable } = await checkAvailability({ username });
      if (usernameAvailable === false) setErr('username','Username already in use');
      else setOk('username');
    } catch {}
  }

  document.addEventListener('DOMContentLoaded', () => {
    const form = $('#signupForm');
    if (!form) return;

    // Live checks
    $('#email')?.addEventListener('input', () => clearField('email'));
    $('#email')?.addEventListener('blur', debounce(onEmailBlur, 200));
    $('#username')?.addEventListener('input', () => clearField('username'));
    $('#username')?.addEventListener('blur', debounce(onUsernameBlur, 200));

    // Password confirmation live cue
    const checkPwMatch = () => {
      const p1 = val('password'), p2 = val('passwordConfirm');
      if (!p2) { clearField('passwordConfirm'); return; }
      if (p1 && p2 && p1 === p2) setOk('passwordConfirm');
      else setErr('passwordConfirm','Passwords do not match');
    };
    $('#password')?.addEventListener('input', () => { clearField('password'); checkPwMatch(); });
    $('#passwordConfirm')?.addEventListener('input', checkPwMatch);

    // Clear legal error when toggled
    $('#agreeLegal')?.addEventListener('change', () => clearField('agreeLegal'));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAll();

      const firstName       = val('firstName');
      const lastName        = val('lastName');
      const username        = val('username');
      const email           = val('email');
      const dateOfBirth     = val('dateOfBirth');
      const password        = val('password');
      const passwordConfirm = val('passwordConfirm');
      const agreeLegal      = document.getElementById('agreeLegal')?.checked === true;

      // Client-side validations
      if (!firstName) setErr('firstName','First name is required');
      if (!lastName)  setErr('lastName','Last name is required');
      if (!email)     setErr('email','Email is required');
      else if (!isEmail(email)) setErr('email','Invalid email');
      if (!dateOfBirth) setErr('dateOfBirth','Date of birth is required');
      if (!password)  setErr('password','Password is required');
      else if (password.length < 8) setErr('password','Password must be at least 8 characters');
      if (!passwordConfirm) setErr('passwordConfirm','Please confirm your password');
      else if (password && passwordConfirm && password !== passwordConfirm) setErr('passwordConfirm','Passwords do not match');
      if (!agreeLegal) setErr('agreeLegal','You must agree to the Terms to create an account');

      if (document.querySelector('.is-invalid')) return;

      // Final availability check
      try {
        const avail = await checkAvailability({ email, username });
        if (avail.emailAvailable === false) setErr('email','Email already registered');
        if (avail.usernameAvailable === false) setErr('username','Username already in use');
      } catch {}
      if (document.querySelector('.is-invalid')) return;

      // Submit
      const btn = $('#signupBtn');
      const original = btn?.textContent;
      btn?.setAttribute('disabled','true');
      if (btn) btn.textContent = 'Creating account…';

      try {
        const res = await fetch((window.API ? API.url('/api/auth/signup') : '/api/auth/signup'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            firstName, lastName, username, email, dateOfBirth,
            password, passwordConfirm,
            agreeLegal: true,
            legalVersion: LEGAL_VERSION
          })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg = data?.error || 'Sign up failed';
          if (/agree|terms|policy|conditions/i.test(msg)) setErr('agreeLegal', msg);
          else if (/email/i.test(msg)) setErr('email', msg);
          else if (/username/i.test(msg)) setErr('username', msg);
          else if (/password/i.test(msg)) setErr('password', msg);
          else if (/birth|dob|date/i.test(msg)) setErr('dateOfBirth', msg);
          else setErr('email', msg);
          return;
        }
        if (data.token) Auth.setToken(data.token);
        const params = new URLSearchParams(location.search);
        const next = params.get('next');
        location.replace(next && next.startsWith('/') ? next : './home.html');
      } catch (err) {
        console.error('Signup POST error:', err);
        setErr('email','Network error — please try again');
      } finally {
        if (btn) btn.textContent = original || 'Create account';
        btn?.removeAttribute('disabled');
      }
    });
  });
})();
