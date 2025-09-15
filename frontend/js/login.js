// /frontend/js/login.js
(function () {
  const form = document.getElementById('login-form');
  const idInput = document.getElementById('identifier');
  const pwInput = document.getElementById('password');
  const remember = document.getElementById('remember');
  const btn = document.getElementById('login-btn');
  const err = document.getElementById('login-error');

  const next = new URLSearchParams(location.search).get('next') || './home.html';
  const BASE = (window.Auth?.apiBase || window.__API_BASE || location.origin).replace(/\/+$/, '');

  function setLoading(v) {
    if (!btn) return;
    if (!btn.dataset.originalText) btn.dataset.originalText = btn.textContent || 'Sign in';
    btn.disabled = v;
    btn.textContent = v ? 'Signing in…' : btn.dataset.originalText;
  }
  function showError(m) {
    if (!err) { alert(m); return; }
    err.textContent = m;
    err.classList.remove('d-none');
  }
  function clearError() {
    if (err) {
      err.textContent = '';
      err.classList.add('d-none');
    }
  }

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const identifier = (idInput?.value || '').trim();
    const password = pwInput?.value || '';
    clearError();

    if (!identifier || !password) {
      showError('Please enter your email/username and password.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ identifier, password }),
      });

      if (res.status === 400) return showError('Invalid credentials.');
      if (res.status === 401) return showError('Unauthorized.');
      if (res.status === 429) return showError('Too many attempts. Try again later.');
      if (!res.ok) return showError(`Login failed (status ${res.status}).`);

      const data = await res.json();
      const token = data?.token;
      if (!token) return showError('No token returned from server.');

      const store = (remember && remember.checked) ? localStorage : sessionStorage;
      try {
        store.setItem('token', token);
        if (data.user) store.setItem('me', JSON.stringify(data.user));
      } catch {}

      location.href = next;
    } catch (e) {
      console.error(e);
      showError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  });
})();
