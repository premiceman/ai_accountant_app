// frontend/js/login.js
(function(){
  const form = document.getElementById('login-form');
  const idInput = document.getElementById('identifier');
  const pwInput = document.getElementById('password');
  const remember = document.getElementById('remember');
  const btn = document.getElementById('login-btn');
  const err = document.getElementById('login-error');
  const next = new URLSearchParams(location.search).get('next') || './home.html';

  function setLoading(v){
    if(!btn) return;
    if (!btn.dataset.originalText) btn.dataset.originalText = btn.textContent || 'Sign in';
    btn.disabled = v;
    btn.textContent = v ? 'Signing in…' : btn.dataset.originalText;
  }
  function showError(m){ if(!err){ alert(m); return; } err.textContent=m; err.classList.remove('d-none'); }
  function clearError(){ if(err){ err.textContent=''; err.classList.add('d-none'); } }

  form?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    clearError();

    const identifier = (idInput?.value||'').trim();
    const password = pwInput?.value || '';
    if(!identifier || !password) return showError('Please enter your email/username and password.');

    const body = identifier.includes('@') ? { email:identifier, password } : { username:identifier, password };

    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify(body)
      });

      if (res.status === 400) {
        let msg = 'Invalid credentials. Please check your details.';
        try { const j = await res.json(); if (j?.error) msg = j.error; } catch {}
        setLoading(false);
        return showError(msg);
      }
      if (res.status >= 500) {
        setLoading(false);
        return showError('Server error. Please try again shortly.');
      }
      if (!res.ok) {
        setLoading(false);
        return showError(`Login failed (status ${res.status}).`);
      }

      const data = await res.json();
      const token = data.token;
      if (!token) {
        setLoading(false);
        return showError('No token returned by server.');
      }

      // Persist token (respect "Remember me")
      if (remember?.checked) {
        Auth.setToken(token, { session: false }); // localStorage
      } else {
        Auth.setToken(token, { session: true });  // sessionStorage
      }

      location.replace(next);
    } catch (e2) {
      console.error('Login network error:', e2);
      showError('Network error. Please try again.');
      setLoading(false);
    }
  });
})();
