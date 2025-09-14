// frontend/js/login.js
(async function () {
  const form = document.getElementById('login-form') || document.querySelector('form');

  async function doLogin(e) {
    e?.preventDefault?.();

    const email = (document.getElementById('email') || {}).value || '';
    const password = (document.getElementById('password') || {}).value || '';
    const body = JSON.stringify({ email, password });

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include', // accept httpOnly cookie sessions
      body
    });

    if (!res.ok) {
      const msg = await res.text().catch(()=>'Login failed');
      alert(msg || 'Login failed');
      return;
    }

    // Try to extract a token if the API returns one
    let token = '';
    try {
      const j = await res.json();
      token = j?.token || j?.jwt || j?.accessToken || j?.idToken || '';
    } catch {
      // Some backends return 204 or text; ignore
    }

    if (token) Auth.setToken(token); // store token if provided

    // Validate session (cookie or token) and go to dashboard
    await Auth.requireAuth();
    location.href = '/home.html';
  }

  form?.addEventListener('submit', doLogin);

  // If already logged in, go straight to home
  try {
    await Auth.requireAuth();
    if (location.pathname.endsWith('/login.html')) {
      location.href = '/home.html';
    }
  } catch {}
})();
