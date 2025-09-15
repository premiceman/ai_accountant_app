// frontend/js/login.js
(function () {
  const form = document.getElementById('login-form') || document.querySelector('form');

  async function doLogin(e) {
    e?.preventDefault?.();

    const email = (document.getElementById('email') || {}).value || '';
    const password = (document.getElementById('password') || {}).value || '';

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      credentials: 'include', // accept httpOnly cookie sessions
      body: JSON.stringify({ email, password })
    });

    if (!res.ok) {
      const msg = await res.text().catch(()=>'Login failed');
      alert(msg || 'Login failed');
      return;
    }

    // If API returns a token, store it. Cookie-only flows work even without this.
    try {
      const j = await res.json().catch(() => ({}));
      const token = j?.token || j?.jwt || j?.accessToken || j?.idToken || '';
      if (token) Auth.setToken(token);
    } catch {}

    // Avoid Set-Cookie timing races: go to dashboard; the page load will verify via /api/user/me
    location.href = '/home.html';
  }

  form?.addEventListener('submit', doLogin);

  // If already authenticated (cookie or token), go straight to home
  (async () => {
    try {
      const res = await fetch('/api/user/me', { credentials: 'include', headers: { 'Accept': 'application/json' }, cache: 'no-store' });
      if (res.ok) {
        const me = await res.json().catch(()=>null);
        if (me && me.id) location.href = '/home.html';
      }
    } catch {}
  })();
})();
