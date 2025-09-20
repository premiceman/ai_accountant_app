// frontend/js/login.js
(function(){
  const form = document.getElementById('login-form');
  const idInput = document.getElementById('identifier');
  const pwInput = document.getElementById('password');
  const remember = document.getElementById('remember');
  const btn = document.getElementById('login-btn');
  const err = document.getElementById('login-error');

  function setLoading(v) {
    if (!btn) return;
    btn.dataset.originalText = btn.dataset.originalText || btn.textContent;
    btn.disabled = v;
    btn.textContent = v ? 'Signing in…' : btn.dataset.originalText;
  }
  function showError(m){
    if (!err) { alert(m); return; }
    err.textContent = m;
    err.classList.remove('d-none');
  }
  function clearError(){
    if (err) { err.textContent = ''; err.classList.add('d-none'); }
  }

  function getNext() {
    const raw = new URLSearchParams(location.search).get('next');
    return (window.Auth && Auth.sanitizeNextParam) ? Auth.sanitizeNextParam(raw) : (raw || '/home.html');
  }

  form?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const identifier = (idInput?.value||'').trim();
    const password = pwInput?.value || '';
    if (!identifier || !password) return showError('Please enter your email/username and password.');
    const body = identifier.includes('@') ? { email: identifier, password } : { username: identifier, password };
    setLoading(true); clearError();
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body)
      });
      if (res.status === 400 || res.status === 401) {
        let msg = 'Invalid credentials. Please try again.';
        try { const j = await res.json(); if (j?.error) msg = j.error; } catch {}
        return showError(msg);
      }
      if (!res.ok) return showError(`Login failed (status ${res.status}).`);
      const data = await res.json();
      const token = data.token;
      if (!token) return showError('No token returned from server.');
      if (remember && remember.checked) localStorage.setItem('token', token);
      else sessionStorage.setItem('token', token);
      if (data.user) try { (remember && remember.checked ? localStorage : sessionStorage).setItem('me', JSON.stringify(data.user)); } catch {}
      const next = getNext();
      location.href = next;
    } catch (e) {
      console.error(e); showError('Network error. Is the server running?');
    } finally {
      setLoading(false);
    }
  });
})();
